package permission

import (
	"context"
	"errors"
	"testing"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestNewDatabaseService(t *testing.T) {
	service := NewDatabaseService(&pgxpool.Pool{})
	if service == nil || service.queries == nil {
		t.Fatal("expected database permission service with queries")
	}
}

type groupQueryStub struct {
	group sqlc.UserGroup
	err   error
}

func (s groupQueryStub) GetUserGroupByKey(context.Context, string) (sqlc.UserGroup, error) {
	return s.group, s.err
}

func TestDatabaseServiceResolve(t *testing.T) {
	tests := []struct {
		name        string
		queries     groupQueries
		permission  string
		wantAllowed bool
		wantErr     bool
	}{
		{
			name:        "current permissions",
			queries:     groupQueryStub{group: sqlc.UserGroup{Permissions: []byte(`["short_link:use_confirmation"]`)}},
			permission:  ShortLinkUseConfirmation,
			wantAllowed: true,
		},
		{name: "missing group", queries: groupQueryStub{err: pgx.ErrNoRows}},
		{name: "invalid json", queries: groupQueryStub{group: sqlc.UserGroup{Permissions: []byte(`{`)}}, wantErr: true},
		{name: "query failure", queries: groupQueryStub{err: errors.New("database down")}, wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &DatabaseService{queries: test.queries}
			snapshot, err := service.Resolve(context.Background(), GroupUser)
			if test.wantErr {
				if err == nil {
					t.Fatal("expected resolve error")
				}
				return
			}
			if err != nil {
				t.Fatalf("resolve permissions: %v", err)
			}
			if snapshot.Has(test.permission) != test.wantAllowed {
				t.Fatalf("permission %q allowed = %t, want %t", test.permission, snapshot.Has(test.permission), test.wantAllowed)
			}
		})
	}
}
