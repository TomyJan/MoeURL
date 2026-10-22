package insights_test

import (
	"context"
	"encoding/base64"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/stretchr/testify/require"
)

// TestAuditPaginationAndAuthorization catches lossy bigint cursors and stale administrator identity.
func TestAuditPaginationAndAuthorization(t *testing.T) {
	pool, service, owner, admin, _, today := fixture(t)
	reader, ok := any(service).(interface {
		Audit(context.Context, auth.CurrentUser, insights.AuditInput) (insights.AuditResult, error)
	})
	require.True(t, ok, "audit reader must be implemented")
	ctx := t.Context()
	_, err := pool.Exec(ctx, `insert into audit_log(id,actor_id,resource_type,resource_id,action,changed_fields,created_at) overriding system value select x,$1::uuid,'user',$1::text,'update',array['nickname'],$2 from generate_series(9007199254740993::bigint,9007199254740995::bigint) x`, owner.ID, today)
	require.NoError(t, err)
	input := insights.AuditInput{PageSize: 2, ActorID: owner.ID, ResourceType: "user", Action: "update"}
	first, err := reader.Audit(ctx, admin, input)
	require.NoError(t, err)
	require.Len(t, first.Items, 2)
	require.Equal(t, "9007199254740995", first.Items[0].ID)
	require.Equal(t, owner.ID, *first.Items[0].ActorID)
	require.Equal(t, "owner", *first.Items[0].ActorUsername)
	require.Equal(t, 180, first.RetentionDays)
	require.True(t, first.HasMore)
	input.Cursor = first.NextCursor
	second, err := reader.Audit(ctx, admin, input)
	require.NoError(t, err)
	require.Len(t, second.Items, 1)
	require.Equal(t, "9007199254740993", second.Items[0].ID)
	require.False(t, second.HasMore)
	require.Empty(t, second.NextCursor)
	for _, bad := range []insights.AuditInput{{PageSize: -1}, {PageSize: 101}, {ActorID: "bad"}, {ResourceType: "session"}, {Action: "login"}, {Cursor: "bad"}, {Cursor: base64.RawURLEncoding.EncodeToString([]byte(`{"id":"01","createdAt":"2026-01-01T00:00:00Z"}`))}} {
		_, err = reader.Audit(ctx, admin, bad)
		require.ErrorIs(t, err, insights.ErrInvalidInput)
	}
	_, err = reader.Audit(ctx, owner, insights.AuditInput{})
	require.ErrorIs(t, err, insights.ErrPermissionDenied)
	_, err = pool.Exec(ctx, `update app_user set status='disabled' where id=$1`, admin.ID)
	require.NoError(t, err)
	_, err = reader.Audit(ctx, admin, insights.AuditInput{})
	require.ErrorIs(t, err, insights.ErrPermissionDenied)
	_, err = pool.Exec(ctx, `update app_user set status='active' where id=$1;`, admin.ID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `update user_group set permissions=permissions-'audit:read' where key='admin'`)
	require.NoError(t, err)
	_, err = reader.Audit(ctx, admin, insights.AuditInput{})
	require.ErrorIs(t, err, insights.ErrPermissionDenied)
}

// TestAuditRetentionReadAndUnknownActor keeps expired logs invisible even before cleanup and preserves null/system identity.
func TestAuditRetentionReadAndUnknownActor(t *testing.T) {
	pool, service, _, admin, _, today := fixture(t)
	ctx := t.Context()
	_, err := pool.Exec(ctx, `insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) values('user','expired','update',array['nickname'],$1),('user','retained','update',array['nickname'],$2)`, today.AddDate(0, 0, -181), today.AddDate(0, 0, -179))
	require.NoError(t, err)
	result, err := service.Audit(ctx, admin, insights.AuditInput{RangeInput: insights.RangeInput{StartDate: today.AddDate(0, 0, -190).Format(time.DateOnly), EndDate: today.AddDate(0, 0, -170).Format(time.DateOnly)}})
	require.NoError(t, err)
	require.Len(t, result.Items, 1)
	require.Equal(t, "retained", result.Items[0].ResourceID)
	require.Nil(t, result.Items[0].ActorID)
	require.Nil(t, result.Items[0].ActorUsername)
}
