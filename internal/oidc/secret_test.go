package oidc

import (
	"bytes"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

// TestSecretBoxRoundTrip verifies versioned ciphertext and record-bound authentication.
func TestSecretBoxRoundTrip(t *testing.T) {
	key := bytes.Repeat([]byte{0x42}, 32)
	box, err := NewSecretBox(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatalf("create secret box: %v", err)
	}
	plaintext := []byte("provider-client-secret")

	first, err := box.Seal("provider-secret", "provider-a", plaintext)
	if err != nil {
		t.Fatalf("seal first secret: %v", err)
	}
	second, err := box.Seal("provider-secret", "provider-a", plaintext)
	if err != nil {
		t.Fatalf("seal second secret: %v", err)
	}
	if bytes.Equal(first, second) {
		t.Fatal("expected randomized ciphertext")
	}
	if bytes.Contains(first, plaintext) {
		t.Fatal("ciphertext contains plaintext")
	}
	opened, err := box.Open("provider-secret", "provider-a", first)
	if err != nil {
		t.Fatalf("open secret: %v", err)
	}
	if !bytes.Equal(opened, plaintext) {
		t.Fatalf("opened secret = %q", opened)
	}

	for _, test := range []struct {
		name    string
		purpose string
		record  string
	}{
		{name: "different purpose", purpose: "login-verifier", record: "provider-a"},
		{name: "different record", purpose: "provider-secret", record: "provider-b"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := box.Open(test.purpose, test.record, first); !errors.Is(err, ErrSecretUnavailable) {
				t.Fatalf("open error = %v", err)
			}
		})
	}
}

// TestSecretBoxRejectsWrongKeyAndMalformedCiphertext verifies decryption fails without diagnostics containing secret material.
func TestSecretBoxRejectsWrongKeyAndMalformedCiphertext(t *testing.T) {
	encodedKey := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x11}, 32))
	box, err := NewSecretBox(encodedKey)
	if err != nil {
		t.Fatalf("create secret box: %v", err)
	}
	ciphertext, err := box.Seal("provider-secret", "provider-a", []byte("sensitive-value"))
	if err != nil {
		t.Fatalf("seal secret: %v", err)
	}
	wrongBox, err := NewSecretBox(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x22}, 32)))
	if err != nil {
		t.Fatalf("create wrong secret box: %v", err)
	}

	cases := []struct {
		name string
		box  *SecretBox
		data []byte
	}{
		{name: "wrong key", box: wrongBox, data: ciphertext},
		{name: "empty", box: box, data: nil},
		{name: "version only", box: box, data: ciphertext[:1]},
		{name: "truncated nonce", box: box, data: ciphertext[:5]},
		{name: "truncated tag", box: box, data: ciphertext[:len(ciphertext)-10]},
		{name: "unknown version", box: box, data: append([]byte{0xff}, ciphertext[1:]...)},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := test.box.Open("provider-secret", "provider-a", test.data)
			if !errors.Is(err, ErrSecretUnavailable) {
				t.Fatalf("open error = %v", err)
			}
			if err != nil && strings.Contains(err.Error(), "sensitive-value") {
				t.Fatal("error exposed plaintext")
			}
		})
	}
}

// TestNewSecretBoxValidatesKey verifies only a Base64-encoded AES-256 key is accepted.
func TestNewSecretBoxValidatesKey(t *testing.T) {
	for _, key := range []string{
		"",
		"not-base64",
		base64.StdEncoding.EncodeToString([]byte("short")),
		base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 31)),
		base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 33)),
	} {
		if _, err := NewSecretBox(key); !errors.Is(err, ErrInvalidEncryptionKey) {
			t.Fatalf("NewSecretBox(%q) error = %v", key, err)
		}
	}

	box, err := NewSecretBox(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)))
	if err != nil || box == nil {
		t.Fatalf("create valid secret box: box=%v err=%v", box, err)
	}
	if _, err := newSecretBox(bytes.Repeat([]byte{1}, 32), nil); !errors.Is(err, ErrInvalidEncryptionKey) {
		t.Fatalf("nil randomness error = %v", err)
	}
}

// TestSecretBoxRejectsInvalidSealArguments verifies encryption fails closed before using the random source.
func TestSecretBoxRejectsInvalidSealArguments(t *testing.T) {
	box := testSecretBox(t)
	for _, test := range []struct {
		name    string
		box     *SecretBox
		purpose string
		record  string
	}{
		{name: "nil box", box: nil, purpose: "provider-secret", record: "provider-a"},
		{name: "missing cipher", box: &SecretBox{}, purpose: "provider-secret", record: "provider-a"},
		{name: "missing random source", box: &SecretBox{aead: box.aead}, purpose: "provider-secret", record: "provider-a"},
		{name: "empty purpose", box: box, record: "provider-a"},
		{name: "empty record", box: box, purpose: "provider-secret"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := test.box.Seal(test.purpose, test.record, []byte("secret")); !errors.Is(err, ErrSecretUnavailable) {
				t.Fatalf("seal error = %v", err)
			}
		})
	}
}

// TestSecretBoxReportsRandomnessFailure verifies sealing stops when a nonce cannot be generated.
func TestSecretBoxReportsRandomnessFailure(t *testing.T) {
	box, err := newSecretBox(bytes.Repeat([]byte{1}, 32), errorReader{})
	if err != nil {
		t.Fatalf("create secret box: %v", err)
	}
	if _, err := box.Seal("provider-secret", "provider-a", []byte("secret")); !errors.Is(err, ErrSecretUnavailable) {
		t.Fatalf("seal error = %v", err)
	}
}

type errorReader struct{}

func (errorReader) Read([]byte) (int, error) {
	return 0, errors.New("randomness unavailable")
}
