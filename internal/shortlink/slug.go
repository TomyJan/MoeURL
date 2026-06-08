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
	"api":    {},
	"assets": {},
	"setup":  {},
	"login":  {},
	"link":   {},
	"links":  {},
	"admin":  {},
}

var slugRandomReader io.Reader = rand.Reader

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

func isReservedSlug(slug string) bool {
	_, ok := reservedSlugs[strings.ToLower(slug)]
	return ok
}
