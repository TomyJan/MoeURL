package shortlink

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestInternalServiceHelpers(t *testing.T) {
	if uuidFromPgtype(pgtype.UUID{}) != "" {
		t.Fatal("expected invalid pgtype UUID to become empty string")
	}

	value := uuid.New()
	if uuidFromPgtype(uuidToPgtype(value)) != value.String() {
		t.Fatal("expected valid pgtype UUID to round trip")
	}

	if buildShortLinkURL("http://go.example.com/", "abc123") != "http://go.example.com/abc123" {
		t.Fatal("expected http host to be preserved")
	}
	if buildShortLinkURL("https://go.example.com/", "abc123") != "https://go.example.com/abc123" {
		t.Fatal("expected https host to be preserved")
	}

	if isUniqueViolation(nil) {
		t.Fatal("expected nil error to not be unique violation")
	}
	if !isUniqueViolation(&pgconn.PgError{Code: "23505"}) {
		t.Fatal("expected PostgreSQL unique violation to be detected")
	}
	if isUniqueViolation(errors.New("plain error")) {
		t.Fatal("expected plain error to not be unique violation")
	}
}
