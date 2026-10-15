package shortlink

import (
	"crypto/rand"
	"io"
	"math/big"
	"strings"
)

const (
	defaultSlugLength = 6
	slugAlphabet      = "abcdefghijklmnopqrstuvwxyz0123456789"
)

var reservedSlugs = map[string]struct{}{
	"api":       {},
	"assets":    {},
	"icons":     {},
	"setup":     {},
	"login":     {},
	"profile":   {},
	"console":   {},
	"link":      {},
	"links":     {},
	"analytics": {},
	"admin":     {},
	"go":        {},
}

var slugRandomReader io.Reader = rand.Reader

// normalizeCustomSlug accepts raw ASCII identifiers without trimming and protects fixed routes.
func normalizeCustomSlug(value string) (string, error) {
	if len(value) < 3 || len(value) > 32 {
		return "", ErrInvalidInput
	}
	for i := range len(value) {
		c := value[i]
		if (c < 'A' || c > 'Z') && (c < 'a' || c > 'z') && (c < '0' || c > '9') {
			return "", ErrInvalidInput
		}
	}
	slug := strings.ToLower(value)
	if isReservedSlug(slug) {
		return "", ErrReservedSlug
	}
	return slug, nil
}

// generateSlug creates a random lowercase alphanumeric short-link slug.
func generateSlug() (string, error) {
	bytes := make([]byte, defaultSlugLength)
	for i := range bytes {
		index, err := rand.Int(slugRandomReader, big.NewInt(int64(len(slugAlphabet))))
		if err != nil {
			return "", err
		}
		bytes[i] = slugAlphabet[index.Int64()]
	}
	return string(bytes), nil
}

// isReservedSlug reports whether a slug conflicts with a fixed application route.
func isReservedSlug(slug string) bool {
	_, ok := reservedSlugs[strings.ToLower(slug)]
	return ok
}
