package auth

import (
	"github.com/stretchr/testify/require"
	"testing"
)

// TestPasswordAuditFailureAndSuccess preserves failure counters but rolls credentials and revocations back on audit failure.
func TestPasswordAuditFailureAndSuccess(t *testing.T) {
	pool, service, hash := passwordFixture(t)
	ctx := t.Context()
	require.ErrorIs(t, service.ChangePassword(ctx, "current", ChangePasswordInput{CurrentPassword: "wrong", NewPassword: "new-password"}), ErrInvalidCredentials)
	var failures, count int
	require.NoError(t, pool.QueryRow(ctx, `select failed_attempts from auth_login_attempt`).Scan(&failures))
	require.Equal(t, 1, failures)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Zero(t, count)
	_, err := pool.Exec(ctx, `alter table audit_log add constraint audit_failure check(false) not valid`)
	require.NoError(t, err)
	input := ChangePasswordInput{CurrentPassword: " old <&密码> ", NewPassword: "new-password"}
	require.Error(t, service.ChangePassword(ctx, "current", input))
	var actual string
	require.NoError(t, pool.QueryRow(ctx, `select password_hash from app_user where username='alice'`).Scan(&actual))
	require.Equal(t, hash, actual)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from session where revoked_at is not null`).Scan(&count))
	require.Zero(t, count)
	_, err = pool.Exec(ctx, `alter table audit_log drop constraint audit_failure`)
	require.NoError(t, err)
	require.NoError(t, service.ChangePassword(ctx, "current", input))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id='00000000-0000-0000-0000-000000000101' and resource_type='user' and action='credential_change' and changed_fields=array['password_hash']`).Scan(&count))
	require.Equal(t, 1, count)
}
