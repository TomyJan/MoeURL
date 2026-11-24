package permission

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
)

func TestNormalizeCustomGroup(t *testing.T) {
	tests := []struct {
		name    string
		values  []string
		want    []string
		wantErr error
	}{
		{name: "empty permissions are allowed", values: []string{}, want: []string{}},
		{
			name:   "permissions use catalog order",
			values: []string{ShortLinkReadOwn, ShortLinkCreate},
			want:   []string{ShortLinkCreate, ShortLinkReadOwn},
		},
		{name: "unknown permission is rejected", values: []string{"permission:unknown"}, wantErr: ErrUnknownPermission},
		{name: "duplicate permission is rejected", values: []string{ShortLinkCreate, ShortLinkCreate}, wantErr: ErrDuplicatePermission},
		{name: "protected permission is rejected", values: []string{AdminAccess}, wantErr: ErrProtectedPermission},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeCustomGroup(test.values)
			if test.wantErr != nil {
				if !errors.Is(err, test.wantErr) {
					t.Fatalf("NormalizeCustomGroup() error = %v, want %v", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeCustomGroup() error = %v", err)
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("NormalizeCustomGroup() = %#v, want %#v", got, test.want)
			}
		})
	}
}

type customGroupPermissionQuery struct {
	group sqlc.UserGroup
	err   error
}

func (q customGroupPermissionQuery) GetUserGroupByKey(context.Context, string) (sqlc.UserGroup, error) {
	return q.group, q.err
}

func TestDatabaseServiceValidatesCustomGroupPermissions(t *testing.T) {
	resolver := &DatabaseService{queries: customGroupPermissionQuery{group: sqlc.UserGroup{
		Key: "550e8400-e29b-41d4-a716-446655440001", Builtin: false, Permissions: []byte(`[` + `"` + ShortLinkReadOwn + `"]`),
	}}}

	snapshot, err := resolver.Resolve(t.Context(), "550e8400-e29b-41d4-a716-446655440001")
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if !snapshot.Has(ShortLinkReadOwn) || snapshot.Has(AdminAccess) {
		t.Fatalf("custom snapshot grants = %#v, want only read-own", snapshot.permissions)
	}

	resolver.queries = customGroupPermissionQuery{group: sqlc.UserGroup{
		Key: "550e8400-e29b-41d4-a716-446655440001", Builtin: false, Permissions: []byte(`["admin:access"]`),
	}}
	_, err = resolver.Resolve(t.Context(), "550e8400-e29b-41d4-a716-446655440001")
	if !errors.Is(err, ErrProtectedPermission) {
		t.Fatalf("Resolve() error = %v, want ErrProtectedPermission", err)
	}
}
