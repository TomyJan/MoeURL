package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

type sessionErrReader struct{}

func (sessionErrReader) Read([]byte) (int, error) {
	return 0, errors.New("random failed")
}

func TestSessionServiceCreateReturnsRandomError(t *testing.T) {
	original := sessionRandomReader
	sessionRandomReader = sessionErrReader{}
	t.Cleanup(func() {
		sessionRandomReader = original
	})

	service := NewSessionService(nil, time.Hour)

	_, err := service.Create(context.Background(), "user-id")
	if err == nil {
		t.Fatal("expected random error")
	}
}
