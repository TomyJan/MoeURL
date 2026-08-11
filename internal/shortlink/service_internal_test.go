package shortlink

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestValidatePasswordInput verifies password modes reject contradictory or out-of-range values.
func TestValidatePasswordInput(t *testing.T) {
	tests := []struct {
		name     string
		input    *PasswordInput
		wantMode string
		wantRaw  string
		wantErr  error
	}{
		{name: "omitted", wantMode: passwordModeKeep},
		{name: "clear", input: &PasswordInput{Mode: PasswordModeNever}, wantMode: PasswordModeNever},
		{name: "set minimum ASCII", input: &PasswordInput{Mode: PasswordModeSet, Value: "12345678"}, wantMode: PasswordModeSet, wantRaw: "12345678"},
		{name: "set minimum Unicode", input: &PasswordInput{Mode: PasswordModeSet, Value: "\u5bc6\u7801\u5b89\u5168\u957f\u5ea6\u516b\u4f4d"}, wantMode: PasswordModeSet, wantRaw: "\u5bc6\u7801\u5b89\u5168\u957f\u5ea6\u516b\u4f4d"},
		{name: "set maximum", input: &PasswordInput{Mode: PasswordModeSet, Value: strings.Repeat("a", 128)}, wantMode: PasswordModeSet, wantRaw: strings.Repeat("a", 128)},
		{name: "set maximum Unicode", input: &PasswordInput{Mode: PasswordModeSet, Value: strings.Repeat("\u5bc6", 128)}, wantMode: PasswordModeSet, wantRaw: strings.Repeat("\u5bc6", 128)},
		{name: "too short", input: &PasswordInput{Mode: PasswordModeSet, Value: "1234567"}, wantErr: ErrInvalidPasswordInput},
		{name: "too long", input: &PasswordInput{Mode: PasswordModeSet, Value: strings.Repeat("a", 129)}, wantErr: ErrInvalidPasswordInput},
		{name: "clear with value", input: &PasswordInput{Mode: PasswordModeNever, Value: "unexpected"}, wantErr: ErrInvalidPasswordInput},
		{name: "unknown mode", input: &PasswordInput{Mode: "keep"}, wantErr: ErrInvalidPasswordInput},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mode, raw, err := validatePasswordInput(test.input)
			if test.wantErr != nil {
				require.ErrorIs(t, err, test.wantErr)
			} else {
				require.NoError(t, err)
			}
			require.Equal(t, test.wantMode, mode)
			require.Equal(t, test.wantRaw, raw)
		})
	}
}

// TestShortLinkPasswordStateMarshalsOnlyEnabledFlag verifies API JSON never exposes password material.
func TestShortLinkPasswordStateMarshalsOnlyEnabledFlag(t *testing.T) {
	raw, err := json.Marshal(ShortLink{AccessConfig: AccessConfig{PasswordEnabled: true}})
	require.NoError(t, err)
	require.Contains(t, string(raw), `"passwordEnabled":true`)
	require.NotContains(t, strings.ToLower(string(raw)), "hash")
}

// TestNormalizePasswordRequiresPermissionAndStoresOnlyHash verifies capability checks and one-way persistence.
func TestNormalizePasswordRequiresPermissionAndStoresOnlyHash(t *testing.T) {
	service := &Service{permissions: permission.NewService()}
	user := auth.CurrentUser{GroupKey: permission.GroupUser, Permissions: []string{permission.ShortLinkSetPassword}}
	mode, hash, err := service.normalizePassword(user, &PasswordInput{Mode: PasswordModeSet, Value: "correct horse"})
	require.NoError(t, err)
	verified := hash.Valid && auth.VerifyPassword("correct horse", hash.String)
	require.Equal(t, PasswordModeSet, mode)
	require.True(t, verified)
	limitedService := &Service{permissions: permission.NewServiceWithPermissions(nil, permission.AdminPermissions)}
	_, _, err = limitedService.normalizePassword(user, &PasswordInput{Mode: PasswordModeSet, Value: "correct horse"})
	require.ErrorIs(t, err, ErrPermissionDenied)
	for _, user := range []auth.CurrentUser{
		auth.GuestUser(),
		{GroupKey: "unknown"},
	} {
		_, _, err := service.normalizePassword(user, &PasswordInput{Mode: PasswordModeSet, Value: "correct horse"})
		require.ErrorIs(t, err, ErrPermissionDenied, user.GroupKey)
	}
}

// TestAnalyticsWithQueriesPropagatesAggregateFailures verifies every aggregate query failure is returned.
func TestAnalyticsWithQueriesPropagatesAggregateFailures(t *testing.T) {
	linkID := uuid.New()
	tests := []struct {
		name    string
		queries analyticsQueryStub
	}{
		{name: "summary", queries: analyticsQueryStub{summaryErr: errors.New("summary")}},
		{name: "trend", queries: analyticsQueryStub{trendErr: errors.New("trend")}},
		{name: "referrers", queries: analyticsQueryStub{referrerErr: errors.New("referrers")}},
		{name: "devices", queries: analyticsQueryStub{deviceErr: errors.New("devices")}},
		{name: "countries", queries: analyticsQueryStub{countryErr: errors.New("countries")}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := analyticsWithQueries(context.Background(), test.queries, linkID, ShortLink{})
			if err == nil || err.Error() != test.name {
				t.Fatalf("analytics error = %v", err)
			}
		})
	}
}

type analyticsQueryStub struct {
	summaryErr  error
	trendErr    error
	referrerErr error
	deviceErr   error
	countryErr  error
}

func (s analyticsQueryStub) GetShortLinkAnalyticsSummary(context.Context, pgtype.UUID) (sqlc.GetShortLinkAnalyticsSummaryRow, error) {
	return sqlc.GetShortLinkAnalyticsSummaryRow{}, s.summaryErr
}

func (s analyticsQueryStub) ListShortLinkDailyVisits(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkDailyVisitsRow, error) {
	return nil, s.trendErr
}

func (s analyticsQueryStub) ListShortLinkReferrerStats(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkReferrerStatsRow, error) {
	return nil, s.referrerErr
}

func (s analyticsQueryStub) ListShortLinkDeviceStats(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkDeviceStatsRow, error) {
	return nil, s.deviceErr
}

func (s analyticsQueryStub) ListShortLinkCountryStats(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkCountryStatsRow, error) {
	return nil, s.countryErr
}

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

// TestCreateRetriesReservedSlug verifies generated slugs skip fixed application routes.
func TestCreateRetriesReservedSlug(t *testing.T) {
	ctx := context.Background()
	pool := internalShortLinkTestPool(t, ctx)
	if _, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000401', 'user', 'User', '', '[]'::jsonb, false, now(), now())
	`); err != nil {
		t.Fatalf("insert user group fixture: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000501', 'reserved-retry-user', 'hash', 'Reserved Retry', '00000000-0000-0000-0000-000000000401', 'active', false, now(), now())
	`); err != nil {
		t.Fatalf("insert user fixture: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000301', 'go.example.com', 'Default', 'short_link', true, true, now(), now())
	`); err != nil {
		t.Fatalf("insert domain fixture: %v", err)
	}

	originalReader := slugRandomReader
	slugRandomReader = bytes.NewReader([]byte{
		0, 18, 18, 4, 19, 18, // assets: reserved route
		0, 1, 2, 27, 28, 29, // abc123: valid retry
	})
	t.Cleanup(func() { slugRandomReader = originalReader })

	service := NewService(pool, permission.NewService())
	result, err := service.Create(ctx, auth.CurrentUser{
		ID:       "00000000-0000-0000-0000-000000000501",
		GroupKey: permission.GroupUser,
	}, CreateInput{TargetURL: "https://example.com"})
	if err != nil {
		t.Fatalf("create after reserved slug: %v", err)
	}
	if result.ShortLink.Slug != "abc123" {
		t.Fatalf("expected reserved slug retry to produce abc123, got %q", result.ShortLink.Slug)
	}
}

// internalShortLinkTestPool opens an isolated migrated database for package-internal service tests.
func internalShortLinkTestPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	return testdb.ProjectMigratedPool(ctx, t)
}

// TestExpirationValuesUsesDatabaseState verifies mapping never recalculates expiration with the application clock.
func TestExpirationValuesUsesDatabaseState(t *testing.T) {
	farFuture := time.Date(2100, time.January, 1, 0, 0, 0, 0, time.UTC)
	expiresAt, expired := expirationValues(pgtype.Timestamptz{Time: farFuture, Valid: true}, true)
	if expiresAt == nil || !expiresAt.Equal(farFuture) || !expired {
		t.Fatalf("expected database expired state for future timestamp, got %v %t", expiresAt, expired)
	}

	farPast := time.Date(2000, time.January, 1, 0, 0, 0, 0, time.UTC)
	_, expired = expirationValues(pgtype.Timestamptz{Time: farPast, Valid: true}, false)
	if expired {
		t.Fatal("expected database non-expired state to override the application clock")
	}

	expiresAt, expired = expirationValues(pgtype.Timestamptz{}, true)
	if expiresAt != nil || expired {
		t.Fatalf("expected missing expiration to remain non-expired, got %v %t", expiresAt, expired)
	}
}

func TestReservedSlugsIncludeSingularPageRoutes(t *testing.T) {
	for _, slug := range []string{"api", "assets", "setup", "login", "profile", "console", "link", "links", "analytics", "admin", "go", "PROFILE", "GO"} {
		if !isReservedSlug(slug) {
			t.Fatalf("expected %q to be reserved", slug)
		}
	}

	if isReservedSlug("abc123") {
		t.Fatal("expected ordinary slug to be available")
	}
}
