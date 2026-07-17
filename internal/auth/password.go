package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"io"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	argonTime    uint32 = 1
	argonMemory  uint32 = 64 * 1024
	argonThreads uint8  = 4
	argonKeyLen  uint32 = 32
	saltLen             = 16
)

var passwordRandomReader io.Reader = rand.Reader

// HashPassword derives an encoded Argon2id password hash with a random salt.
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := io.ReadFull(passwordRandomReader, salt); err != nil {
		return "", err
	}

	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf(
		"$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory,
		argonTime,
		argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPassword reports whether a password matches an encoded Argon2id hash.
func VerifyPassword(password string, encodedHash string) bool {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}

	memory, timeCost, threads := parseArgonParams(parts[3])
	actual := argon2.IDKey([]byte(password), salt, timeCost, memory, threads, argonKeyLen)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

// parseArgonParams parses the time, memory, and parallelism values in a hash.
func parseArgonParams(value string) (uint32, uint32, uint8) {
	memory := argonMemory
	timeCost := argonTime
	threads := argonThreads

	for _, part := range strings.Split(value, ",") {
		keyValue := strings.SplitN(part, "=", 2)
		if len(keyValue) != 2 {
			continue
		}
		parsed, err := strconv.ParseUint(keyValue[1], 10, 32)
		if err != nil || parsed == 0 {
			continue
		}
		switch keyValue[0] {
		case "m":
			memory = uint32(parsed)
		case "t":
			timeCost = uint32(parsed)
		case "p":
			if parsed <= 255 {
				threads = uint8(parsed)
			}
		}
	}

	return memory, timeCost, threads
}
