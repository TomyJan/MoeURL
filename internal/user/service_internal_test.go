package user

import (
	"errors"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
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

func TestSupplementalMembershipHelpersPreserveEmptyAndCompareKeys(t *testing.T) {
	validID := uuid.New()
	if id, err := parseCanonicalUserID(validID.String()); err != nil || id != validID {
		t.Fatalf("canonical ID parse = %s, %v", id, err)
	}
	for _, raw := range []string{"not-a-uuid", uuid.Nil.String(), "550E8400-E29B-41D4-A716-446655440001"} {
		if _, err := parseCanonicalUserID(raw); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("noncanonical ID %q error = %v", raw, err)
		}
	}

	keys := []string{"550e8400-e29b-41d4-a716-446655440002", "550e8400-e29b-41d4-a716-446655440001"}
	if normalized, err := normalizeSupplementalGroupKeys(keys); err != nil || normalized[0] > normalized[1] {
		t.Fatalf("supplemental key normalization = %#v, %v", normalized, err)
	}
	if supplementalGroupKeysEqual([]sqlc.GetSupplementalUserGroupsByIDRow{{Key: keys[0]}}, []string{keys[1]}) {
		t.Fatal("different same-length membership sets compared equal")
	}
	if !supplementalGroupKeysEqual([]sqlc.GetSupplementalUserGroupsByIDRow{{Key: keys[0]}}, []string{keys[0]}) {
		t.Fatal("identical membership sets compared different")
	}
	summary := userSummaryWithSupplementalGroups(sqlc.AppUser{}, permission.GroupUser, nil)
	if summary.SupplementalGroups == nil || len(summary.SupplementalGroups) != 0 {
		t.Fatalf("empty supplemental groups = %#v, want a non-nil empty array", summary.SupplementalGroups)
	}
}
