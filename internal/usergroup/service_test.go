package usergroup

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var errTestInfrastructure = errors.New("test infrastructure failure")

type fakeGroupQueries struct {
	listResult   []sqlc.UserGroup
	listErr      error
	updateResult sqlc.UserGroup
	updateErr    error
	getResult    sqlc.UserGroup
	getErr       error

	listCalls   int
	updateCalls int
	getCalls    int
	updateInput sqlc.UpdateBuiltinUserGroupPermissionsParams
}

func (f *fakeGroupQueries) ListBuiltinUserGroups(context.Context) ([]sqlc.UserGroup, error) {
	f.listCalls++
	return f.listResult, f.listErr
}

func (f *fakeGroupQueries) UpdateBuiltinUserGroupPermissions(_ context.Context, input sqlc.UpdateBuiltinUserGroupPermissionsParams) (sqlc.UserGroup, error) {
	f.updateCalls++
	f.updateInput = input
	return f.updateResult, f.updateErr
}

func (f *fakeGroupQueries) GetUserGroupByKey(context.Context, string) (sqlc.UserGroup, error) {
	f.getCalls++
	return f.getResult, f.getErr
}

type recordingResolver struct {
	delegate permission.Resolver
	err      error
	calls    int
	groupKey string
}

func (r *recordingResolver) Resolve(ctx context.Context, groupKey string) (permission.Snapshot, error) {
	r.calls++
	r.groupKey = groupKey
	if r.err != nil {
		return permission.Snapshot{}, r.err
	}
	return r.delegate.Resolve(ctx, groupKey)
}

func adminResolver() *recordingResolver {
	return &recordingResolver{delegate: permission.NewService()}
}

func nonAdminResolver() *recordingResolver {
	return &recordingResolver{delegate: permission.NewServiceWithPermissions(nil, nil)}
}

func testService(queries groupQueries, resolver permission.Resolver) *Service {
	return &Service{queries: queries, permissions: resolver}
}

func testActor(groupKey string) auth.CurrentUser {
	return auth.CurrentUser{ID: "actor-id", GroupKey: groupKey}
}

func databaseGroup(key string, permissions []string, builtin bool, updatedAt time.Time) sqlc.UserGroup {
	encoded, err := json.Marshal(permissions)
	if err != nil {
		panic(err)
	}
	return sqlc.UserGroup{
		Key:         key,
		Name:        "Group " + key,
		Description: "Description " + key,
		Permissions: encoded,
		Builtin:     builtin,
		UpdatedAt:   pgtype.Timestamptz{Time: updatedAt, Valid: true},
	}
}

func TestServiceListReturnsNormalizedBuiltinGroupsAndCatalog(t *testing.T) {
	updatedAt := time.Date(2026, time.August, 20, 11, 12, 13, 123456789, time.FixedZone("offset", 8*60*60))
	queries := &fakeGroupQueries{listResult: []sqlc.UserGroup{
		databaseGroup(permission.GroupGuest, []string{}, true, updatedAt),
		databaseGroup(permission.GroupUser, []string{permission.DomainUseDefault, permission.ShortLinkCreate}, true, updatedAt),
		databaseGroup(permission.GroupAdmin, permission.AdminPermissions, true, updatedAt),
	}}
	resolver := adminResolver()

	result, err := testService(queries, resolver).List(context.Background(), testActor(permission.GroupAdmin))
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if resolver.calls != 1 || resolver.groupKey != permission.GroupAdmin {
		t.Fatalf("resolver calls = %d for %q, want one admin snapshot", resolver.calls, resolver.groupKey)
	}
	if queries.listCalls != 1 {
		t.Fatalf("list query calls = %d, want 1", queries.listCalls)
	}
	if len(result.Groups) != 3 {
		t.Fatalf("groups length = %d, want 3", len(result.Groups))
	}
	if result.Groups[0].Editable || !result.Groups[1].Editable || !result.Groups[2].Editable {
		t.Fatalf("editable states = %v, want guest false and user/admin true", []bool{result.Groups[0].Editable, result.Groups[1].Editable, result.Groups[2].Editable})
	}
	wantPermissions := []string{permission.ShortLinkCreate, permission.DomainUseDefault}
	if !reflect.DeepEqual(result.Groups[1].Permissions, wantPermissions) {
		t.Fatalf("normalized permissions = %#v, want %#v", result.Groups[1].Permissions, wantPermissions)
	}
	wantUpdatedAt := updatedAt.UTC().Format(time.RFC3339Nano)
	if result.Groups[1].UpdatedAt != wantUpdatedAt {
		t.Fatalf("updatedAt = %q, want %q", result.Groups[1].UpdatedAt, wantUpdatedAt)
	}
	if !reflect.DeepEqual(result.Permissions, permission.Definitions()) {
		t.Fatalf("permission definitions differ from catalog")
	}
	if !reflect.DeepEqual(result.Presets, permission.Presets()) {
		t.Fatalf("permission presets differ from catalog")
	}
}

func TestServiceListRejectsNonAdministratorBeforeQuery(t *testing.T) {
	queries := &fakeGroupQueries{}
	resolver := nonAdminResolver()

	_, err := testService(queries, resolver).List(context.Background(), testActor(permission.GroupUser))
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("List() error = %v, want ErrPermissionDenied", err)
	}
	if resolver.calls != 1 || queries.listCalls != 0 {
		t.Fatalf("resolver calls = %d, query calls = %d, want 1 and 0", resolver.calls, queries.listCalls)
	}
}

func TestServiceListPropagatesResolverErrorBeforeQuery(t *testing.T) {
	queries := &fakeGroupQueries{}
	resolver := &recordingResolver{err: errTestInfrastructure}

	_, err := testService(queries, resolver).List(context.Background(), testActor(permission.GroupAdmin))
	if !errors.Is(err, errTestInfrastructure) {
		t.Fatalf("List() error = %v, want resolver error", err)
	}
	if resolver.calls != 1 || queries.listCalls != 0 {
		t.Fatalf("resolver calls = %d, query calls = %d, want 1 and 0", resolver.calls, queries.listCalls)
	}
}

func TestServiceListRejectsMissingResolver(t *testing.T) {
	service := NewService(nil, nil)

	_, err := service.List(context.Background(), testActor(permission.GroupAdmin))
	if !errors.Is(err, ErrPermissionResolverNeeded) {
		t.Fatalf("List() error = %v, want ErrPermissionResolverNeeded", err)
	}
}

func TestServiceListPropagatesQueryError(t *testing.T) {
	queries := &fakeGroupQueries{listErr: errTestInfrastructure}

	_, err := testService(queries, adminResolver()).List(context.Background(), testActor(permission.GroupAdmin))
	if !errors.Is(err, errTestInfrastructure) {
		t.Fatalf("List() error = %v, want query error", err)
	}
}

func TestServiceListTreatsStoredPermissionViolationsAsInfrastructureErrors(t *testing.T) {
	tests := []struct {
		name        string
		group       sqlc.UserGroup
		wantErrorIs error
	}{
		{name: "invalid JSON", group: sqlc.UserGroup{Key: permission.GroupUser, Permissions: []byte("{"), Builtin: true}, wantErrorIs: nil},
		{name: "unknown permission", group: databaseGroup(permission.GroupUser, []string{"unknown"}, true, time.Now()), wantErrorIs: permission.ErrUnknownPermission},
		{name: "duplicate permission", group: databaseGroup(permission.GroupUser, []string{permission.ShortLinkCreate, permission.ShortLinkCreate}, true, time.Now()), wantErrorIs: permission.ErrDuplicatePermission},
		{name: "protected ownership", group: databaseGroup(permission.GroupUser, []string{permission.AdminAccess}, true, time.Now()), wantErrorIs: permission.ErrProtectedPermission},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			queries := &fakeGroupQueries{listResult: []sqlc.UserGroup{test.group}}
			_, err := testService(queries, adminResolver()).List(context.Background(), testActor(permission.GroupAdmin))
			if err == nil {
				t.Fatal("List() error = nil, want infrastructure error")
			}
			if errors.Is(err, ErrInvalidInput) {
				t.Fatalf("List() error = %v, must not be ErrInvalidInput", err)
			}
			if test.wantErrorIs != nil && !errors.Is(err, test.wantErrorIs) {
				t.Fatalf("List() error = %v, want %v", err, test.wantErrorIs)
			}
		})
	}
}

func TestServiceUpdatePermissionsNormalizesAndReturnsFullTimestampPrecision(t *testing.T) {
	expectedAt := "2026-08-20T03:04:05.123456789Z"
	updatedAt := time.Date(2026, time.August, 20, 3, 4, 5, 987654321, time.UTC)
	queries := &fakeGroupQueries{updateResult: databaseGroup(
		permission.GroupUser,
		[]string{permission.DomainUseDefault, permission.ShortLinkCreate},
		true,
		updatedAt,
	)}
	resolver := adminResolver()

	result, err := testService(queries, resolver).UpdatePermissions(context.Background(), testActor(permission.GroupAdmin), UpdatePermissionsInput{
		GroupKey:          permission.GroupUser,
		Permissions:       []string{permission.DomainUseDefault, permission.ShortLinkCreate},
		ExpectedUpdatedAt: expectedAt,
	})
	if err != nil {
		t.Fatalf("UpdatePermissions() error = %v", err)
	}
	if resolver.calls != 1 || queries.updateCalls != 1 || queries.getCalls != 0 {
		t.Fatalf("calls: resolver=%d update=%d get=%d, want 1,1,0", resolver.calls, queries.updateCalls, queries.getCalls)
	}
	if queries.updateInput.GroupKey != permission.GroupUser {
		t.Fatalf("group key = %q, want user", queries.updateInput.GroupKey)
	}
	var stored []string
	if err := json.Unmarshal(queries.updateInput.Permissions, &stored); err != nil {
		t.Fatalf("decode stored permissions: %v", err)
	}
	wantPermissions := []string{permission.ShortLinkCreate, permission.DomainUseDefault}
	if !reflect.DeepEqual(stored, wantPermissions) {
		t.Fatalf("stored permissions = %#v, want %#v", stored, wantPermissions)
	}
	if !queries.updateInput.ExpectedUpdatedAt.Valid || queries.updateInput.ExpectedUpdatedAt.Time.Format(time.RFC3339Nano) != expectedAt {
		t.Fatalf("expected timestamp = %#v, want %s", queries.updateInput.ExpectedUpdatedAt, expectedAt)
	}
	if result.Group.UpdatedAt != updatedAt.Format(time.RFC3339Nano) {
		t.Fatalf("updated result timestamp = %q, want full precision", result.Group.UpdatedAt)
	}
	if !reflect.DeepEqual(result.Group.Permissions, wantPermissions) {
		t.Fatalf("result permissions = %#v, want %#v", result.Group.Permissions, wantPermissions)
	}
}

func TestServiceUpdatePermissionsAcceptsAdminGroupWithProtectedPermissions(t *testing.T) {
	updatedAt := time.Date(2026, time.August, 20, 3, 4, 6, 123456000, time.UTC)
	queries := &fakeGroupQueries{updateResult: databaseGroup(permission.GroupAdmin, permission.AdminPermissions, true, updatedAt)}

	result, err := testService(queries, adminResolver()).UpdatePermissions(context.Background(), testActor(permission.GroupAdmin), UpdatePermissionsInput{
		GroupKey:          permission.GroupAdmin,
		Permissions:       permission.AdminPermissions,
		ExpectedUpdatedAt: "2026-08-20T03:04:05.123456Z",
	})
	if err != nil {
		t.Fatalf("UpdatePermissions() error = %v", err)
	}
	if result.Group.Key != permission.GroupAdmin || queries.updateCalls != 1 {
		t.Fatalf("result group = %q, update calls = %d, want admin and 1", result.Group.Key, queries.updateCalls)
	}
}

func TestServiceUpdatePermissionsPropagatesPermissionEncodingError(t *testing.T) {
	originalMarshal := marshalPermissions
	marshalPermissions = func(any) ([]byte, error) {
		return nil, errTestInfrastructure
	}
	t.Cleanup(func() { marshalPermissions = originalMarshal })
	queries := &fakeGroupQueries{}

	_, err := testService(queries, adminResolver()).UpdatePermissions(context.Background(), testActor(permission.GroupAdmin), UpdatePermissionsInput{
		GroupKey:          permission.GroupUser,
		Permissions:       []string{},
		ExpectedUpdatedAt: "2026-08-20T03:04:05Z",
	})
	if !errors.Is(err, errTestInfrastructure) {
		t.Fatalf("UpdatePermissions() error = %v, want encoding error", err)
	}
	if queries.updateCalls != 0 {
		t.Fatalf("update calls = %d, want 0", queries.updateCalls)
	}
}

func TestServiceUpdatePermissionsAuthorizesBeforeValidationAndQuery(t *testing.T) {
	queries := &fakeGroupQueries{}
	resolver := nonAdminResolver()

	_, err := testService(queries, resolver).UpdatePermissions(context.Background(), testActor(permission.GroupUser), UpdatePermissionsInput{})
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("UpdatePermissions() error = %v, want ErrPermissionDenied", err)
	}
	if resolver.calls != 1 || queries.updateCalls != 0 {
		t.Fatalf("resolver calls = %d, update calls = %d, want 1 and 0", resolver.calls, queries.updateCalls)
	}
}

func TestServiceUpdatePermissionsPropagatesResolverErrorBeforeValidation(t *testing.T) {
	queries := &fakeGroupQueries{}
	resolver := &recordingResolver{err: errTestInfrastructure}

	_, err := testService(queries, resolver).UpdatePermissions(context.Background(), testActor(permission.GroupAdmin), UpdatePermissionsInput{})
	if !errors.Is(err, errTestInfrastructure) {
		t.Fatalf("UpdatePermissions() error = %v, want resolver error", err)
	}
	if resolver.calls != 1 || queries.updateCalls != 0 {
		t.Fatalf("resolver calls = %d, update calls = %d, want 1 and 0", resolver.calls, queries.updateCalls)
	}
}

func TestServiceUpdatePermissionsRejectsMissingResolver(t *testing.T) {
	_, err := NewService(nil, nil).UpdatePermissions(context.Background(), testActor(permission.GroupAdmin), UpdatePermissionsInput{})
	if !errors.Is(err, ErrPermissionResolverNeeded) {
		t.Fatalf("UpdatePermissions() error = %v, want ErrPermissionResolverNeeded", err)
	}
}

func TestServiceUpdatePermissionsValidatesInputAndProtectionRules(t *testing.T) {
	validTime := "2026-08-20T03:04:05.123456Z"
	tests := []struct {
		name      string
		input     UpdatePermissionsInput
		wantError error
	}{
		{name: "guest is read only", input: UpdatePermissionsInput{GroupKey: permission.GroupGuest, ExpectedUpdatedAt: validTime}, wantError: ErrProtectedPermission},
		{name: "empty group", input: UpdatePermissionsInput{ExpectedUpdatedAt: validTime}, wantError: ErrInvalidInput},
		{name: "unknown group", input: UpdatePermissionsInput{GroupKey: "custom", ExpectedUpdatedAt: validTime}, wantError: ErrInvalidInput},
		{name: "invalid time", input: UpdatePermissionsInput{GroupKey: permission.GroupUser, ExpectedUpdatedAt: "not-time"}, wantError: ErrInvalidInput},
		{name: "missing permissions array", input: UpdatePermissionsInput{GroupKey: permission.GroupUser, Permissions: nil, ExpectedUpdatedAt: validTime}, wantError: ErrInvalidInput},
		{name: "unknown permission", input: UpdatePermissionsInput{GroupKey: permission.GroupUser, Permissions: []string{"unknown"}, ExpectedUpdatedAt: validTime}, wantError: ErrInvalidInput},
		{name: "duplicate permission", input: UpdatePermissionsInput{GroupKey: permission.GroupUser, Permissions: []string{permission.ShortLinkCreate, permission.ShortLinkCreate}, ExpectedUpdatedAt: validTime}, wantError: ErrInvalidInput},
		{name: "protected permission granted to user", input: UpdatePermissionsInput{GroupKey: permission.GroupUser, Permissions: []string{permission.AdminAccess}, ExpectedUpdatedAt: validTime}, wantError: ErrProtectedPermission},
		{name: "protected permissions removed from admin", input: UpdatePermissionsInput{GroupKey: permission.GroupAdmin, Permissions: []string{}, ExpectedUpdatedAt: validTime}, wantError: ErrProtectedPermission},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			queries := &fakeGroupQueries{}
			resolver := adminResolver()
			_, err := testService(queries, resolver).UpdatePermissions(context.Background(), testActor(permission.GroupAdmin), test.input)
			if !errors.Is(err, test.wantError) {
				t.Fatalf("UpdatePermissions() error = %v, want %v", err, test.wantError)
			}
			if resolver.calls != 1 || queries.updateCalls != 0 {
				t.Fatalf("calls: resolver=%d update=%d, want 1,0", resolver.calls, queries.updateCalls)
			}
		})
	}
}

func TestServiceUpdatePermissionsMapsConditionalMiss(t *testing.T) {
	input := UpdatePermissionsInput{
		GroupKey:          permission.GroupUser,
		Permissions:       []string{},
		ExpectedUpdatedAt: "2026-08-20T03:04:05Z",
	}
	tests := []struct {
		name      string
		getResult sqlc.UserGroup
		getErr    error
		wantError error
	}{
		{name: "missing group", getErr: pgx.ErrNoRows, wantError: ErrUserGroupNotFound},
		{name: "non builtin group", getResult: databaseGroup(permission.GroupUser, nil, false, time.Now()), wantError: ErrUserGroupNotFound},
		{name: "stale timestamp", getResult: databaseGroup(permission.GroupUser, nil, true, time.Now()), wantError: ErrPermissionConflict},
		{name: "lookup failure", getErr: errTestInfrastructure, wantError: errTestInfrastructure},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			queries := &fakeGroupQueries{updateErr: pgx.ErrNoRows, getResult: test.getResult, getErr: test.getErr}
			_, err := testService(queries, adminResolver()).UpdatePermissions(context.Background(), testActor(permission.GroupAdmin), input)
			if !errors.Is(err, test.wantError) {
				t.Fatalf("UpdatePermissions() error = %v, want %v", err, test.wantError)
			}
			if queries.updateCalls != 1 || queries.getCalls != 1 {
				t.Fatalf("calls: update=%d get=%d, want 1,1", queries.updateCalls, queries.getCalls)
			}
		})
	}
}

func TestServiceUpdatePermissionsPropagatesUpdateErrorWithoutLookup(t *testing.T) {
	queries := &fakeGroupQueries{updateErr: errTestInfrastructure}

	_, err := testService(queries, adminResolver()).UpdatePermissions(context.Background(), testActor(permission.GroupAdmin), UpdatePermissionsInput{
		GroupKey:          permission.GroupUser,
		Permissions:       []string{},
		ExpectedUpdatedAt: "2026-08-20T03:04:05Z",
	})
	if !errors.Is(err, errTestInfrastructure) {
		t.Fatalf("UpdatePermissions() error = %v, want update error", err)
	}
	if queries.getCalls != 0 {
		t.Fatalf("lookup calls = %d, want 0", queries.getCalls)
	}
}

func TestServiceUpdatePermissionsTreatsReturnedGroupViolationAsInfrastructureError(t *testing.T) {
	queries := &fakeGroupQueries{updateResult: sqlc.UserGroup{
		Key:         permission.GroupUser,
		Builtin:     true,
		Permissions: []byte("{"),
	}}

	_, err := testService(queries, adminResolver()).UpdatePermissions(context.Background(), testActor(permission.GroupAdmin), UpdatePermissionsInput{
		GroupKey:          permission.GroupUser,
		Permissions:       []string{},
		ExpectedUpdatedAt: "2026-08-20T03:04:05Z",
	})
	if err == nil || errors.Is(err, ErrInvalidInput) {
		t.Fatalf("UpdatePermissions() error = %v, want infrastructure error", err)
	}
}
