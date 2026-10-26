package insights_test

import (
	"context"
	"encoding/csv"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// auditExporter fails behaviorally against the existing PostgreSQL-backed service before implementation.
func auditExporter(t *testing.T, service *insights.Service) insights.AuditExportPort {
	t.Helper()
	port, ok := any(service).(insights.AuditExportPort)
	require.True(t, ok, "audit export must be implemented on the real service")
	return port
}

// TestAuditExportLimits distinguishes candidate count, raw JSON bytes and encoded CSV bytes.
func TestAuditExportLimits(t *testing.T) {
	pool, service, _, admin, _, today := fixture(t)
	port := auditExporter(t, service)
	for _, invalid := range []insights.AuditExportInput{{ActorID: "bad"}, {ResourceType: "session"}, {Action: "login"}, {RangeInput: insights.RangeInput{Days: "1"}}} {
		result, err := port.ExportAudit(t.Context(), admin, invalid)
		require.ErrorIs(t, err, insights.ErrInvalidInput)
		require.Empty(t, result.Content)
	}
	result, err := port.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
	require.NoError(t, err)
	require.Len(t, auditCells(t, result), 1)
	_, err = pool.Exec(t.Context(), `insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) select 'user','','update','{}',$1 from generate_series(1,1000)`, today)
	require.NoError(t, err)
	result, err = port.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
	require.NoError(t, err)
	require.Len(t, auditCells(t, result), 1001)
	_, err = pool.Exec(t.Context(), `insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) values('domain','','create','{}',$1)`, today)
	require.NoError(t, err)
	result, err = port.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
	require.ErrorIs(t, err, insights.ErrAuditExportLimit)
	require.Empty(t, result.Content)
	result, err = port.ExportAudit(t.Context(), admin, insights.AuditExportInput{ResourceType: "domain", Action: "create"})
	require.NoError(t, err)
	require.Len(t, auditCells(t, result), 2)
	query := sqlc.New(pool)
	params := sqlc.ExportAuditLogsParams{StartAt: pgtype.Timestamptz{Time: today, Valid: true}, EndAt: pgtype.Timestamptz{Time: today.AddDate(0, 0, 1), Valid: true}, RetentionCutoff: pgtype.Timestamptz{Time: today.AddDate(0, 0, -180), Valid: true}}
	rows, e := query.ExportAuditLogs(t.Context(), params)
	require.NoError(t, e)
	require.Len(t, rows, 1)
	require.True(t, rows[0].LimitExceeded)
	require.Empty(t, rows[0].ChangedFields)
	_, err = pool.Exec(t.Context(), `delete from audit_log`)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) values('user','','update','{}',$1)`, today)
	require.NoError(t, err)
	// Independent raw byte calculation: resource_type=4, action=6, empty JSON array=2.
	for _, size := range []int{8388608 - 12, 8388608 - 11} {
		_, err = pool.Exec(t.Context(), `update audit_log set resource_id=repeat('x',$1)`, size)
		require.NoError(t, err)
		rows, e = query.ExportAuditLogs(t.Context(), params)
		require.NoError(t, e)
		require.Len(t, rows, 1)
		if size == 8388608-12 {
			require.False(t, rows[0].LimitExceeded)
			require.Len(t, rows[0].ResourceID, size)
		} else {
			require.True(t, rows[0].LimitExceeded)
			require.Empty(t, rows[0].ID)
			require.Empty(t, rows[0].ResourceID)
			require.Empty(t, rows[0].ChangedFields)
		}
		result, err = port.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
		require.ErrorIs(t, err, insights.ErrAuditExportLimit)
		require.Empty(t, result.Content)
	}
	// Empty array elements still consume JSON quotes and separators: JSON length=3*n+1.
	for _, suffix := range []string{"xx", "xxx"} {
		_, err = pool.Exec(t.Context(), `update audit_log set resource_id=repeat('雪',2796198)||$1`, suffix)
		require.NoError(t, err)
		rows, e = query.ExportAuditLogs(t.Context(), params)
		require.NoError(t, e)
		require.Equal(t, suffix == "xxx", rows[0].LimitExceeded)
	}
	_, err = pool.Exec(t.Context(), `update audit_log set resource_id='',changed_fields=array_fill(''::text,array[2796199])`)
	require.NoError(t, err)
	rows, e = query.ExportAuditLogs(t.Context(), params)
	require.NoError(t, e)
	require.False(t, rows[0].LimitExceeded)
	require.Len(t, rows[0].ChangedFields, 8388598)
	_, err = pool.Exec(t.Context(), `update audit_log set changed_fields=array_append(changed_fields,'')`)
	require.NoError(t, err)
	rows, e = query.ExportAuditLogs(t.Context(), params)
	require.NoError(t, e)
	require.True(t, rows[0].LimitExceeded)
	require.Empty(t, rows[0].ChangedFields)
	_, err = pool.Exec(t.Context(), `update audit_log set changed_fields='{}',resource_id=''`)
	require.NoError(t, err)
	baseline, err := port.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
	require.NoError(t, err)
	for _, extra := range []int{0, 1} {
		_, err = pool.Exec(t.Context(), `update audit_log set resource_id=repeat('x',$1)`, 8388608-len(baseline.Content)+extra)
		require.NoError(t, err)
		result, err = port.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
		if extra == 0 {
			require.NoError(t, err)
			require.Len(t, result.Content, 8388608)
		} else {
			require.ErrorIs(t, err, insights.ErrAuditExportLimit)
			require.Empty(t, result.Content)
		}
	}
	_, err = pool.Exec(t.Context(), `update audit_log set resource_id=repeat('"',4194304)`)
	require.NoError(t, err)
	result, err = port.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
	require.ErrorIs(t, err, insights.ErrAuditExportLimit)
	require.Empty(t, result.Content)
}

// TestAuditExportActorsRetentionAndFormulas preserves system and missing accounts and bounded UTC retention.
func TestAuditExportActorsRetentionAndFormulas(t *testing.T) {
	pool, service, owner, admin, _, today := fixture(t)
	port := auditExporter(t, service)
	missing := uuid.NewString()
	_, err := pool.Exec(t.Context(), `insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields,created_at) values(null,'user','system','update','{}',$1),($2,'user','missing','update',array[null,'雪'],$1)`, today, missing)
	require.NoError(t, err)
	r, err := port.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
	require.NoError(t, err)
	rows := auditCells(t, r)
	require.Len(t, rows, 3)
	require.Equal(t, missing, rows[1][5])
	require.Empty(t, rows[1][6])
	require.Equal(t, `[null,"雪"]`, rows[1][10])
	require.Empty(t, rows[2][5])
	require.Equal(t, "[]", rows[2][10])
	for _, value := range []string{"=1", " +1", "\u2003-1", "@SUM(1)", "\tunsafe", "\runsafe", "\nunsafe", "雪,\"山\""} {
		_, err = pool.Exec(t.Context(), `update audit_log set resource_id=$1 where actor_id is null`, value)
		require.NoError(t, err)
		r, err = port.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
		require.NoError(t, err)
		want := "'" + strings.ReplaceAll(value, "\r", "")
		if value == "雪,\"山\"" {
			want = value
		}
		require.Equal(t, want, auditCells(t, r)[2][8])
	}
	_, err = pool.Exec(t.Context(), `update app_user set username='=formula' where id=$1;`, owner.ID)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields,created_at) values($1,'user','owner','update','{}',$2)`, owner.ID, today)
	require.NoError(t, err)
	r, err = port.ExportAudit(t.Context(), admin, insights.AuditExportInput{ActorID: owner.ID})
	require.NoError(t, err)
	require.Equal(t, "'=formula", auditCells(t, r)[1][6])
	_, err = pool.Exec(t.Context(), `delete from audit_log`)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) values('user','expired','update','{}',$1),('user','retained','update','{}',$2)`, today.AddDate(0, 0, -181), today.AddDate(0, 0, -179))
	require.NoError(t, err)
	r, err = port.ExportAudit(t.Context(), admin, insights.AuditExportInput{RangeInput: insights.RangeInput{StartDate: today.AddDate(0, 0, -185).Format(time.DateOnly), EndDate: today.AddDate(0, 0, -175).Format(time.DateOnly)}})
	require.NoError(t, err)
	rows = auditCells(t, r)
	require.Len(t, rows, 2)
	require.Equal(t, "retained", rows[1][8])
	// Query the exact inclusive retention edge without a moving wall-clock expectation.
	cutoff := today.AddDate(0, 0, -180)
	_, err = pool.Exec(t.Context(), `insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) values('domain','before','create','{}',$1),('domain','at','create','{}',$2),('domain','after','create','{}',$3)`, cutoff.Add(-time.Microsecond), cutoff, cutoff.Add(time.Microsecond))
	require.NoError(t, err)
	edge, err := sqlc.New(pool).ExportAuditLogs(t.Context(), sqlc.ExportAuditLogsParams{StartAt: pgtype.Timestamptz{Time: cutoff.AddDate(0, 0, -1), Valid: true}, EndAt: pgtype.Timestamptz{Time: cutoff.AddDate(0, 0, 1), Valid: true}, RetentionCutoff: pgtype.Timestamptz{Time: cutoff, Valid: true}, ResourceType: "domain", Action: "create"})
	require.NoError(t, err)
	require.Len(t, edge, 2)
	require.Equal(t, "after", edge[0].ResourceID)
	require.Equal(t, "at", edge[1].ResourceID)
}

func auditCells(t *testing.T, result insights.AuditExport) [][]string {
	t.Helper()
	require.Equal(t, "text/csv;charset=utf-8", result.ContentType)
	require.True(t, strings.HasPrefix(result.Content, "\ufeff"))
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Content, "\ufeff"))).ReadAll()
	require.NoError(t, err)
	require.Equal(t, []string{"start_date", "end_date", "time_zone", "audit_id", "occurred_at", "actor_id", "actor_username", "resource_type", "resource_id", "action", "changed_fields"}, rows[0])
	return rows
}

// TestAuditExportAuthorization catches trusting session grants or omitting any required permission.
func TestAuditExportAuthorization(t *testing.T) {
	pool, service, owner, admin, _, _ := fixture(t)
	port := auditExporter(t, service)
	for _, actor := range []auth.CurrentUser{owner, auth.GuestUser(), {ID: "bad"}, {ID: uuid.NewString()}} {
		_, err := port.ExportAudit(t.Context(), actor, insights.AuditExportInput{})
		require.ErrorIs(t, err, insights.ErrPermissionDenied)
	}
	for _, key := range []string{"admin:access", "audit:read", "audit:export"} {
		t.Run(key, func(t *testing.T) {
			var original []byte
			require.NoError(t, pool.QueryRow(t.Context(), `select permissions from user_group where key='admin'`).Scan(&original))
			t.Cleanup(func() {
				_, err := pool.Exec(context.Background(), `update user_group set permissions=$1 where key='admin'`, original)
				require.NoError(t, err)
			})
			_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions-$1 where key='admin'`, key)
			require.NoError(t, err)
			result, err := port.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
			require.ErrorIs(t, err, insights.ErrPermissionDenied)
			require.Empty(t, result.Content)
		})
	}
	for _, statement := range []string{`update app_user set status='disabled' where username='admin'`, `update app_user set status='active',deleted_at=now() where username='admin'`, `update app_user set deleted_at=null,group_id=(select id from user_group where key='guest') where username='admin'`} {
		_, err := pool.Exec(t.Context(), statement)
		require.NoError(t, err)
		_, err = port.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
		require.ErrorIs(t, err, insights.ErrPermissionDenied)
	}
}

// TestAuditExportFilteringAndCSV catches lossy IDs, filter leakage and flattening JSON arrays.
func TestAuditExportFilteringAndCSV(t *testing.T) {
	pool, service, owner, admin, _, today := fixture(t)
	port := auditExporter(t, service)
	_, err := pool.Exec(t.Context(), `insert into audit_log(id,actor_id,resource_type,resource_id,action,changed_fields,created_at) overriding system value select x,$1::uuid,'user','雪,"山"','update',array['nickname','comma,field','quote"field','雪'],$2 from generate_series(9007199254740993::bigint,9007199254740995::bigint) x`, owner.ID, today)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into audit_log(id,actor_id,resource_type,resource_id,action,changed_fields,created_at) overriding system value select x,$1::uuid,'user','small','update','{}',$2 from unnest(array[9,10]) x`, owner.ID, today)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) values('domain','excluded','create','{}',$1),('user','old','update','{}',$2)`, today, today.Add(-time.Microsecond))
	require.NoError(t, err)
	input := insights.AuditExportInput{RangeInput: insights.RangeInput{StartDate: today.Format(time.DateOnly), EndDate: today.Format(time.DateOnly)}, ActorID: owner.ID, ResourceType: "user", Action: "update"}
	result, err := port.ExportAudit(t.Context(), admin, input)
	require.NoError(t, err)
	rows := auditCells(t, result)
	require.Len(t, rows, 6)
	require.Equal(t, "9007199254740995", rows[1][3])
	require.Equal(t, "9007199254740993", rows[3][3])
	require.Equal(t, "10", rows[4][3])
	require.Equal(t, "9", rows[5][3])
	require.Equal(t, []string{today.Format(time.DateOnly), today.Format(time.DateOnly), "UTC", "9007199254740995", today.Format(time.RFC3339Nano), owner.ID, "owner", "user", "雪,\"山\"", "update", `["nickname","comma,field","quote\"field","雪"]`}, rows[1])
	require.Equal(t, "moeurl-audit-"+today.Format(time.DateOnly)+"-"+today.Format(time.DateOnly)+".csv", result.FileName)
	require.Contains(t, result.Content, "\r\n")
	require.NotContains(t, result.Content, "target.example")
}
