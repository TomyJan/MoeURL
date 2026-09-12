package oidc

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
)

const secretCipherVersion byte = 1

var (
	ErrInvalidEncryptionKey = errors.New("invalid OIDC encryption key")
	ErrSecretUnavailable    = errors.New("OIDC secret unavailable")
)

// SecretBox encrypts short-lived and persisted OIDC secrets with record-bound authentication.
type SecretBox struct {
	aead   cipher.AEAD
	random io.Reader
}

// NewSecretBox creates an AES-256-GCM box from a Base64-encoded 32-byte key.
func NewSecretBox(encodedKey string) (*SecretBox, error) {
	key, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil || len(key) != 32 {
		return nil, ErrInvalidEncryptionKey
	}
	return newSecretBox(key, rand.Reader)
}

// newSecretBox creates a box with an explicit randomness source for deterministic tests.
func newSecretBox(key []byte, random io.Reader) (*SecretBox, error) {
	if len(key) != 32 || random == nil {
		return nil, ErrInvalidEncryptionKey
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, ErrInvalidEncryptionKey
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, ErrInvalidEncryptionKey
	}
	return &SecretBox{aead: aead, random: random}, nil
}

// Seal encrypts plaintext for one purpose and record using a fresh nonce.
func (b *SecretBox) Seal(purpose string, recordID string, plaintext []byte) ([]byte, error) {
	if b == nil || b.aead == nil || b.random == nil || purpose == "" || recordID == "" {
		return nil, ErrSecretUnavailable
	}
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := io.ReadFull(b.random, nonce); err != nil {
		return nil, ErrSecretUnavailable
	}
	result := make([]byte, 1+len(nonce), 1+len(nonce)+len(plaintext)+b.aead.Overhead())
	result[0] = secretCipherVersion
	copy(result[1:], nonce)
	return b.aead.Seal(result, nonce, plaintext, secretAAD(purpose, recordID)), nil
}

// Open decrypts and authenticates ciphertext for its original purpose and record.
func (b *SecretBox) Open(purpose string, recordID string, ciphertext []byte) ([]byte, error) {
	if b == nil || b.aead == nil || purpose == "" || recordID == "" || len(ciphertext) < 1+b.aead.NonceSize()+b.aead.Overhead() {
		return nil, ErrSecretUnavailable
	}
	if ciphertext[0] != secretCipherVersion {
		return nil, ErrSecretUnavailable
	}
	nonceEnd := 1 + b.aead.NonceSize()
	plaintext, err := b.aead.Open(nil, ciphertext[1:nonceEnd], ciphertext[nonceEnd:], secretAAD(purpose, recordID))
	if err != nil {
		return nil, ErrSecretUnavailable
	}
	return plaintext, nil
}

// secretAAD prevents ciphertext from being substituted across purposes or database records.
func secretAAD(purpose string, recordID string) []byte {
	return []byte("moeurl:oidc:" + purpose + "\x00" + recordID)
}
