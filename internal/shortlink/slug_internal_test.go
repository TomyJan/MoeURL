package shortlink

import (
	"errors"
	"testing"
)

type slugErrReader struct{}

// Read returns the configured entropy-source failure for the test double.
func (slugErrReader) Read([]byte) (int, error) {
	return 0, errors.New("random failed")
}

// TestGenerateSlugReturnsRandomError verifies generate slug returns random error.
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
