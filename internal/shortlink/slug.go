package shortlink

import (
	"crypto/rand"
	"math/big"
)

const (
	defaultSlugLength = 6
	slugAlphabet      = "abcdefghijklmnopqrstuvwxyz0123456789"
)

var reservedSlugs = map[string]struct{}{
	"api":    {},
	"assets": {},
	"setup":  {},
	"login":  {},
	"links":  {},
	"admin":  {},
}

func generateSlug() (string, error) {
	bytes := make([]byte, defaultSlugLength)
	for i := range bytes {
		index, err := rand.Int(rand.Reader, big.NewInt(int64(len(slugAlphabet))))
		if err != nil {
			return "", err
		}
		bytes[i] = slugAlphabet[index.Int64()]
	}
	return string(bytes), nil
}

func isReservedSlug(slug string) bool {
	_, ok := reservedSlugs[slug]
	return ok
}
