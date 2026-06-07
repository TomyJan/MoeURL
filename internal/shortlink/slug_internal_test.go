package shortlink

import (
	"errors"
	"testing"
)

type slugErrReader struct{}

func (slugErrReader) Read([]byte) (int, error) {
	return 0, errors.New("random failed")
}

func TestGenerateSlugReturnsRandomError(t *testing.T) {
	original := slugRandomReader
	slugRandomReader = slugErrReader{}
	t.Cleanup(func() {
		slugRandomReader = original
	})

	_, err := generateSlug()
	if err == nil {
		t.Fatal("expected random error")
	}
}
