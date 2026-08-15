package user

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestNewServiceLogsPermissionFallback verifies missing permission dependencies produce an observable warning.
func TestNewServiceLogsPermissionFallback(t *testing.T) {
	var output bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&output, nil)))
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	service := NewService(nil, nil)
	if service.permissions == nil {
		t.Fatal("expected fallback permission resolver")
	}
	for _, field := range []string{"user_permission_resolver_fallback", "resolver=permission.NewService"} {
		if !strings.Contains(output.String(), field) {
			t.Fatalf("expected fallback log field %q, got %q", field, output.String())
		}
	}
}

// TestFormatTimeHandlesInvalidAndValidValues verifies format time handles invalid and valid values.
func TestFormatTimeHandlesInvalidAndValidValues(t *testing.T) {
	if formatTime(pgtype.Timestamptz{}) != "" {
		t.Fatal("expected invalid timestamp to become empty string")
	}

	value := time.Date(2026, 8, 2, 10, 11, 12, 0, time.FixedZone("CST", 8*60*60))
	if got := formatTime(pgtype.Timestamptz{Time: value, Valid: true}); got != "2026-08-02T02:11:12Z" {
		t.Fatalf("unexpected formatted timestamp: %q", got)
	}
}

// TestUUIDFromPgtypeReturnsEmptyForInvalidValue verifies uuid from pgtype returns empty for invalid value.
func TestUUIDFromPgtypeReturnsEmptyForInvalidValue(t *testing.T) {
	if uuidFromPgtype(pgtype.UUID{}) != "" {
		t.Fatal("expected invalid pgtype UUID to become empty string")
	}

	value := uuid.New()
	if uuidFromPgtype(uuidToPgtype(value)) != value.String() {
		t.Fatal("expected valid pgtype UUID to round trip")
	}
}
