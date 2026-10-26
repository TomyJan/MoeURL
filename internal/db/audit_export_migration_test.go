package db_test

import (
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestAuditExportPermissionMigrationRoundTrip catches rollback loss of preexisting and independently restored grants.
func TestAuditExportPermissionMigrationRoundTrip(t *testing.T) {
	for _, test := range []struct {
		name, before, after string
		retained            bool
	}{
		{"migration owned", "", "", false},
		{"preexisting", `update user_group set permissions=permissions || '["audit:export"]'::jsonb where key='admin'`, "", true},
		{"removed restored", "", `update user_group set permissions=permissions-'audit:export' where key='admin'; update user_group set permissions=permissions || '["audit:export"]'::jsonb where key='admin'`, true},
		{"removed", "", `update user_group set permissions=permissions-'audit:export' where key='admin'`, false},
		{"unrelated edit", "", `update user_group set permissions=permissions || '["future:permission"]'::jsonb,name='renamed' where key='admin'`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := t.Context()
			db := migrationTestDatabase(t, ctx)
			dir := filepath.Join("..", "..", "migrations")
			require.NoError(t, goose.UpTo(db, dir, 23))
			insertUserGroups(t, ctx, db)
			_, err := db.ExecContext(ctx, `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','preservedauditexport','https://example.com','active',now(),'2026-01-01Z'); insert into short_link_event(id,short_link_id,event_type,created_at) select gen_random_uuid(),id,'redirect_response_sent',now() from short_link`)
			require.NoError(t, err)
			_, err = db.ExecContext(ctx, `insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) values('user','preserved-audit','update',array['nickname'],'2026-01-01Z')`)
			require.NoError(t, err)
			var beforeAudit string
			require.NoError(t, db.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(a) order by id)::text from audit_log a`).Scan(&beforeAudit))
			if test.before != "" {
				_, err := db.ExecContext(ctx, test.before)
				require.NoError(t, err)
			}
			_, err = db.ExecContext(ctx, `update user_group set updated_at='2020-01-01T00:00:00Z'`)
			require.NoError(t, err)
			require.NoError(t, goose.UpTo(db, dir, 24))
			require.NoError(t, goose.UpTo(db, dir, 24))
			for _, key := range []string{"user", "admin", "guest"} {
				var changed bool
				require.NoError(t, db.QueryRowContext(ctx, `select updated_at>'2020-01-01T00:00:00Z' from user_group where key=$1`, key).Scan(&changed))
				require.Equal(t, key == "admin" && test.name != "preexisting", changed)
			}
			assertGrant := func(key string, want bool) {
				var got bool
				require.NoError(t, db.QueryRowContext(ctx, `select permissions ? 'audit:export' from user_group where key=$1`, key).Scan(&got))
				require.Equal(t, want, got, key)
			}
			assertGrant("user", false)
			assertGrant("admin", true)
			assertGrant("guest", false)
			_, err = db.ExecContext(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values(gen_random_uuid(),'late','late','["audit:export"]',false,now(),now())`)
			require.NoError(t, err)
			if test.after != "" {
				_, err = db.ExecContext(ctx, test.after)
				require.NoError(t, err)
			}
			require.NoError(t, goose.DownTo(db, dir, 23))
			assertGrant("user", false)
			assertGrant("admin", test.retained)
			assertGrant("late", true)
			var unchanged bool
			require.NoError(t, db.QueryRowContext(ctx, `select slug='preservedauditexport' and updated_at='2026-01-01Z'::timestamptz and (select count(*) from short_link_event)=1 and (select count(*) from audit_log)=1 from short_link`).Scan(&unchanged))
			require.True(t, unchanged)
			var afterAudit string
			require.NoError(t, db.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(a) order by id)::text from audit_log a`).Scan(&afterAudit))
			require.Equal(t, beforeAudit, afterAudit)
			if test.name == "unrelated edit" {
				var retained bool
				require.NoError(t, db.QueryRowContext(ctx, `select permissions ? 'future:permission' and name='renamed' from user_group where key='admin'`).Scan(&retained))
				require.True(t, retained)
			}
			require.NoError(t, goose.UpTo(db, dir, 24))
			assertGrant("user", false)
			assertGrant("admin", true)
		})
	}
	t.Run("groups inserted after migration", func(t *testing.T) {
		ctx := t.Context()
		db := migrationTestDatabase(t, ctx)
		dir := filepath.Join("..", "..", "migrations")
		require.NoError(t, goose.UpTo(db, dir, 24))
		insertUserGroups(t, ctx, db)
		_, err := db.ExecContext(ctx, `update user_group set permissions=permissions || '["audit:export"]'::jsonb where key in ('user','admin')`)
		require.NoError(t, err)
		require.NoError(t, goose.DownTo(db, dir, 23))
		var count int
		require.NoError(t, db.QueryRowContext(ctx, `select count(*) from user_group where permissions ? 'audit:export'`).Scan(&count))
		require.Equal(t, 2, count)
	})
	t.Run("nonbuiltin groups", func(t *testing.T) {
		ctx := t.Context()
		db := migrationTestDatabase(t, ctx)
		dir := filepath.Join("..", "..", "migrations")
		require.NoError(t, goose.UpTo(db, dir, 23))
		insertUserGroups(t, ctx, db)
		_, err := db.ExecContext(ctx, `update user_group set builtin=false where key in ('user','admin')`)
		require.NoError(t, err)
		require.NoError(t, goose.UpTo(db, dir, 24))
		var count int
		require.NoError(t, db.QueryRowContext(ctx, `select count(*) from user_group where permissions ? 'audit:export'`).Scan(&count))
		require.Zero(t, count)
		require.NoError(t, goose.DownTo(db, dir, 23))
	})
}
