package user

import (
	"errors"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestNewServiceFailsClosedWithoutPermissionResolver verifies missing permission wiring never grants static defaults.
func TestNewServiceFailsClosedWithoutPermissionResolver(t *testing.T) {
	service := NewService(nil, nil)

	_, err := service.permissions.Resolve(t.Context(), permission.GroupAdmin)
	if !errors.Is(err, errPermissionResolverRequired) {
		t.Fatalf("expected missing resolver sentinel, got %v", err)
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
