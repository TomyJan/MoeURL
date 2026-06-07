package auth

import (
	"errors"
	"strings"
	"testing"
)

type errReader struct{}

func (errReader) Read([]byte) (int, error) {
	return 0, errors.New("random failed")
}

func TestHashPasswordReturnsRandomError(t *testing.T) {
	original := passwordRandomReader
	passwordRandomReader = errReader{}
	t.Cleanup(func() {
		passwordRandomReader = original
	})

	_, err := HashPassword("secret")
	if err == nil {
		t.Fatal("expected random error")
	}
}

func TestVerifyPasswordRejectsMalformedHashes(t *testing.T) {
	tests := []string{
		"not-argon",
		"$argon2i$v=19$m=65536,t=1,p=4$salt$key",
		"$argon2id$v=19$m=65536,t=1,p=4$not base64$key",
		"$argon2id$v=19$m=65536,t=1,p=4$c2FsdA$not base64",
	}

	for _, hash := range tests {
		t.Run(hash, func(t *testing.T) {
			if VerifyPassword("secret", hash) {
				t.Fatalf("expected %q to be rejected", hash)
			}
		})
	}
}

func TestVerifyPasswordParsesFallbackArgonParams(t *testing.T) {
	encoded, err := HashPassword("secret")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	encoded = strings.Replace(encoded, "m=65536,t=1,p=4", "m=bad,t=0,p=999,ignored", 1)

	if !VerifyPassword("secret", encoded) {
		t.Fatal("expected password to verify with fallback argon params")
	}
}
