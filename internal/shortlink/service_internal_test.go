package shortlink

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
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
	"github.com/stretchr/testify/require"
)

// TestNewServiceLogsPermissionFallbackWithInjectedLogger verifies degraded constructor wiring is observable.
func TestNewServiceLogsPermissionFallbackWithInjectedLogger(t *testing.T) {
	var logOutput bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logOutput, nil))

	NewServiceWithLogger(nil, nil, logger)

	require.Contains(t, logOutput.String(), "short_link_permission_resolver_fallback")
	require.Contains(t, logOutput.String(), "permission.NewService")
}

type failingPermissionResolver struct {
	err error
}

// Resolve implements the corresponding operation for the surrounding test double.
func (r failingPermissionResolver) Resolve(context.Context, string) (permission.Snapshot, error) {
	return permission.Snapshot{}, r.err
}

type recordingPermissionResolver struct {
	delegate permission.Resolver
	err      error
	calls    int
	groupKey string
}

// Resolve records each authorization lookup before delegating or returning the configured error.
func (r *recordingPermissionResolver) Resolve(ctx context.Context, groupKey string) (permission.Snapshot, error) {
	r.calls++
	r.groupKey = groupKey
	if r.err != nil {
		return permission.Snapshot{}, r.err
	}
	return r.delegate.Resolve(ctx, groupKey)
}

// TestServiceAuthorizeResolvesOneReusableSnapshot verifies regular authorization checks every required permission in one lookup.
func TestServiceAuthorizeResolvesOneReusableSnapshot(t *testing.T) {
	wantErr := errors.New("permission database down")
	tests := []struct {
		name     string
		resolver *recordingPermissionResolver
		wantErr  error
	}{
		{
			name: "authorized",
			resolver: &recordingPermissionResolver{
				delegate: permission.NewService(),
			},
		},
		{
			name: "missing required permission",
			resolver: &recordingPermissionResolver{
				delegate: permission.NewServiceWithPermissions([]string{permission.ShortLinkCreate}, permission.AdminPermissions),
			},
			wantErr: ErrPermissionDenied,
		},
		{
			name:     "resolver failure",
			resolver: &recordingPermissionResolver{err: wantErr},
			wantErr:  wantErr,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &Service{permissions: test.resolver}
			permissions, err := service.authorize(
				t.Context(),
				auth.CurrentUser{GroupKey: permission.GroupUser},
				permission.ShortLinkCreate,
				permission.DomainUseDefault,
			)

			require.ErrorIs(t, err, test.wantErr)
			require.Equal(t, 1, test.resolver.calls)
			require.Equal(t, permission.GroupUser, test.resolver.groupKey)
			if test.wantErr == nil {
				require.True(t, permissions.Has(permission.ShortLinkUseConfirmation))
			}
		})
	}
}

// TestServiceAuthorizeAdminCombinesRequiredPermissions verifies administrator authorization uses one reusable snapshot.
func TestServiceAuthorizeAdminCombinesRequiredPermissions(t *testing.T) {
	wantErr := errors.New("permission database down")
	tests := []struct {
		name     string
		resolver *recordingPermissionResolver
		wantErr  error
	}{
		{
			name: "authorized",
			resolver: &recordingPermissionResolver{
				delegate: permission.NewService(),
			},
		},
		{
			name: "missing admin access",
			resolver: &recordingPermissionResolver{
				delegate: permission.NewServiceWithPermissions(permission.UserPermissions, []string{permission.ShortLinkReadAll}),
			},
			wantErr: ErrPermissionDenied,
		},
		{
			name: "missing action permission",
			resolver: &recordingPermissionResolver{
				delegate: permission.NewServiceWithPermissions(permission.UserPermissions, []string{permission.AdminAccess}),
			},
			wantErr: ErrPermissionDenied,
		},
		{
			name:     "resolver failure",
			resolver: &recordingPermissionResolver{err: wantErr},
			wantErr:  wantErr,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &Service{permissions: test.resolver}
			permissions, err := service.authorizeAdmin(
				t.Context(),
				auth.CurrentUser{GroupKey: permission.GroupAdmin},
				permission.ShortLinkReadAll,
			)

			require.ErrorIs(t, err, test.wantErr)
			require.Equal(t, 1, test.resolver.calls)
			require.Equal(t, permission.GroupAdmin, test.resolver.groupKey)
			if test.wantErr == nil {
				require.True(t, permissions.Has(permission.ShortLinkUseConfirmation))
			}
		})
	}
}

// TestServicePermissionResolutionFailuresPropagate verifies authorization infrastructure errors never become permission grants.
func TestServicePermissionResolutionFailuresPropagate(t *testing.T) {
	wantErr := errors.New("permission database down")
	service := &Service{permissions: failingPermissionResolver{err: wantErr}}
	ctx := context.Background()
	user := auth.CurrentUser{GroupKey: permission.GroupUser}
	admin := auth.CurrentUser{GroupKey: permission.GroupAdmin}

	tests := []struct {
		name string
		call func() error
	}{
		{name: "create", call: func() error { _, err := service.Create(ctx, user, CreateInput{}); return err }},
		{name: "overview", call: func() error { _, err := service.Overview(ctx, user); return err }},
		{name: "list", call: func() error { _, err := service.List(ctx, user, ListInput{}); return err }},
		{name: "update", call: func() error { _, err := service.Update(ctx, user, UpdateInput{}); return err }},
		{name: "delete", call: func() error { return service.Delete(ctx, user, DeleteInput{}) }},
		{name: "statistics", call: func() error { _, err := service.Statistics(ctx, user, StatisticsInput{}); return err }},
		{name: "admin statistics", call: func() error { _, err := service.AdminStatistics(ctx, admin, StatisticsInput{}); return err }},
		{name: "admin list", call: func() error { _, err := service.AdminList(ctx, admin, ListInput{}); return err }},
		{name: "admin update", call: func() error { _, err := service.AdminUpdate(ctx, admin, UpdateInput{}); return err }},
		{name: "admin delete", call: func() error { return service.AdminDelete(ctx, admin, DeleteInput{}) }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.ErrorIs(t, test.call(), wantErr)
		})
	}
}

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
	service := permission.NewService()
	userPermissions, err := service.Resolve(context.Background(), permission.GroupUser)
	require.NoError(t, err)
	mode, hash, err := normalizePassword(userPermissions, &PasswordInput{Mode: PasswordModeSet, Value: "correct horse"})
	require.NoError(t, err)
	verified := hash.Valid && auth.VerifyPassword("correct horse", hash.String)
	require.Equal(t, PasswordModeSet, mode)
	require.True(t, verified)
	adminPermissions, err := service.Resolve(context.Background(), permission.GroupAdmin)
	require.NoError(t, err)
	mode, hash, err = normalizePassword(adminPermissions, &PasswordInput{Mode: PasswordModeSet, Value: "correct horse"})
	require.NoError(t, err)
	require.Equal(t, PasswordModeSet, mode)
	require.True(t, hash.Valid)
	require.True(t, auth.VerifyPassword("correct horse", hash.String))
	mode, hash, err = normalizePassword(adminPermissions, &PasswordInput{Mode: PasswordModeNever})
	require.NoError(t, err)
	require.Equal(t, PasswordModeNever, mode)
	require.False(t, hash.Valid)
	limitedPermissions, err := permission.NewServiceWithPermissions(nil, permission.AdminPermissions).Resolve(context.Background(), permission.GroupUser)
	require.NoError(t, err)
	_, _, err = normalizePassword(limitedPermissions, &PasswordInput{Mode: PasswordModeSet, Value: "correct horse"})
	require.ErrorIs(t, err, ErrPermissionDenied)
	for _, groupKey := range []string{
		permission.GroupGuest,
		"unknown",
	} {
		permissions, resolveErr := service.Resolve(context.Background(), groupKey)
		require.NoError(t, resolveErr)
		_, _, err := normalizePassword(permissions, &PasswordInput{Mode: PasswordModeSet, Value: "correct horse"})
		require.ErrorIs(t, err, ErrPermissionDenied, groupKey)
	}
}

// TestAccessConfigDefaultsPreserveCreateAndUpdateSemantics locks the distinct omitted-field persistence shapes.
func TestAccessConfigDefaultsPreserveCreateAndUpdateSemantics(t *testing.T) {
	ctx := context.Background()
	permissions, err := permission.NewServiceWithPermissions(nil, permission.AdminPermissions).Resolve(ctx, permission.GroupUser)
	require.NoError(t, err)
	service := &Service{}

	createConfig, err := service.createAccessConfig(ctx, permissions, CreateInput{})
	require.NoError(t, err)
	require.Equal(t, RedirectModeDirect, createConfig.redirectMode)
	require.Equal(t, defaultIntermediateDelay, createConfig.intermediateDelaySeconds)
	require.False(t, createConfig.expiresAt.Valid)
	require.False(t, createConfig.passwordHash.Valid)

	updateConfig, err := service.updateAccessConfig(ctx, permissions, UpdateInput{})
	require.NoError(t, err)
	require.False(t, updateConfig.redirectMode.Valid)
	require.False(t, updateConfig.intermediateDelaySeconds.Valid)
	require.Equal(t, expirationModeKeep, updateConfig.expirationMode)
	require.False(t, updateConfig.expiresAt.Valid)
	require.Equal(t, passwordModeKeep, updateConfig.passwordMode)
	require.False(t, updateConfig.passwordHash.Valid)
}

// TestAccessConfigAuthorizationMatchesCreateAndUpdate locks shared permission results and error precedence.
func TestAccessConfigAuthorizationMatchesCreateAndUpdate(t *testing.T) {
	confirmationMode := RedirectModeConfirmation
	directMode := RedirectModeDirect
	invalidMode := "invalid"
	validDelay := defaultIntermediateDelay
	invalidDelay := minIntermediateDelay - 1
	clearExpiration := &ExpirationInput{Mode: ExpirationModeNever}
	invalidExpiration := &ExpirationInput{Mode: ExpirationModeAt}
	clearPassword := &PasswordInput{Mode: PasswordModeNever}
	setPassword := &PasswordInput{Mode: PasswordModeSet, Value: "correct horse"}
	allAccessPermissions := []string{
		permission.ShortLinkUseIntermediate,
		permission.ShortLinkSetExpiration,
		permission.ShortLinkSetPassword,
		permission.ShortLinkUseConfirmation,
	}

	tests := []struct {
		name         string
		permissions  []string
		redirectMode *string
		delay        *int16
		expiration   *ExpirationInput
		password     *PasswordInput
		wantErr      error
	}{
		{
			name:         "authorized",
			permissions:  allAccessPermissions,
			redirectMode: &confirmationMode,
			delay:        &validDelay,
			expiration:   clearExpiration,
			password:     clearPassword,
		},
		{name: "invalid redirect mode first", redirectMode: &invalidMode, wantErr: ErrInvalidRedirectMode},
		{name: "invalid delay first", redirectMode: &directMode, delay: &invalidDelay, wantErr: ErrInvalidIntermediateDelay},
		{name: "redirect mode permission", redirectMode: &confirmationMode, wantErr: ErrPermissionDenied},
		{name: "explicit delay permission", redirectMode: &directMode, delay: &validDelay, wantErr: ErrPermissionDenied},
		{name: "expiration permission", redirectMode: &directMode, expiration: clearExpiration, wantErr: ErrPermissionDenied},
		{
			name:         "expiration validation before password permission",
			permissions:  []string{permission.ShortLinkSetExpiration},
			redirectMode: &directMode,
			expiration:   invalidExpiration,
			password:     setPassword,
			wantErr:      ErrInvalidExpiration,
		},
		{name: "password permission", redirectMode: &directMode, password: clearPassword, wantErr: ErrPermissionDenied},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			permissions, err := permission.NewServiceWithPermissions(test.permissions, permission.AdminPermissions).Resolve(ctx, permission.GroupUser)
			require.NoError(t, err)
			service := &Service{}
			createInput := CreateInput{
				IntermediateDelaySeconds: test.delay,
				Expiration:               test.expiration,
				Password:                 test.password,
			}
			if test.redirectMode != nil {
				createInput.RedirectMode = *test.redirectMode
			}
			_, createErr := service.createAccessConfig(ctx, permissions, createInput)
			_, updateErr := service.updateAccessConfig(ctx, permissions, UpdateInput{
				RedirectMode:             test.redirectMode,
				IntermediateDelaySeconds: test.delay,
				Expiration:               test.expiration,
				Password:                 test.password,
			})

			if test.wantErr == nil {
				require.NoError(t, createErr)
				require.NoError(t, updateErr)
				return
			}
			require.ErrorIs(t, createErr, test.wantErr)
			require.ErrorIs(t, updateErr, test.wantErr)
		})
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

// GetShortLinkAnalyticsSummary implements the corresponding operation for the surrounding test double.
func (s analyticsQueryStub) GetShortLinkAnalyticsSummary(context.Context, pgtype.UUID) (sqlc.GetShortLinkAnalyticsSummaryRow, error) {
	return sqlc.GetShortLinkAnalyticsSummaryRow{}, s.summaryErr
}

// ListShortLinkDailyVisits implements the corresponding operation for the surrounding test double.
func (s analyticsQueryStub) ListShortLinkDailyVisits(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkDailyVisitsRow, error) {
	return nil, s.trendErr
}

// ListShortLinkReferrerStats implements the corresponding operation for the surrounding test double.
func (s analyticsQueryStub) ListShortLinkReferrerStats(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkReferrerStatsRow, error) {
	return nil, s.referrerErr
}

// ListShortLinkDeviceStats implements the corresponding operation for the surrounding test double.
func (s analyticsQueryStub) ListShortLinkDeviceStats(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkDeviceStatsRow, error) {
	return nil, s.deviceErr
}

// ListShortLinkCountryStats implements the corresponding operation for the surrounding test double.
func (s analyticsQueryStub) ListShortLinkCountryStats(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkCountryStatsRow, error) {
	return nil, s.countryErr
}

// TestInternalServiceHelpers verifies internal service helpers.
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
	pool := testdb.ProjectMigratedPool(ctx, t)
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

// TestReservedSlugsIncludeSingularPageRoutes verifies reserved slugs include singular page routes.
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
