package shortlink

import (
	"context"
	"encoding/csv"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// TestListExportCSV checks every cell with an independent real CSV reader.
func TestListExportCSV(t *testing.T) {
	at := time.Date(2026, 10, 24, 12, 34, 56, 123, time.FixedZone("SG", 8*3600))
	row := sqlc.ExportShortLinkListRow{Allowed: true, ID: "id", DomainHost: "go.example", Slug: "slug1", TargetUrl: "https://example.com/a,\"b\"\nc", Title: " \u2003=1", Tags: []string{"=formula", "a,b"}, Status: "disabled", RedirectMode: "confirmation", IntermediateDelaySeconds: 5, ExpiresAt: pgtype.Timestamptz{Time: at, Valid: true}, PasswordEnabled: true, MaxVisits: 123, VisitsUsed: 42, CreatedAt: pgtype.Timestamptz{Time: at, Valid: true}, UpdatedAt: pgtype.Timestamptz{Time: at, Valid: true}, OwnerID: "owner-id", OwnerUsername: "\towner"}
	result, err := listExportCSV([]sqlc.ExportShortLinkListRow{row}, false)
	require.NoError(t, err)
	require.Equal(t, "moeurl-links-own.csv", result.FileName)
	require.Equal(t, "text/csv;charset=utf-8", result.ContentType)
	require.True(t, strings.HasPrefix(result.Content, "\ufeffid,short_url,"))
	require.NotContains(t, strings.ReplaceAll(result.Content, "\r\n", ""), "\n")
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Content, "\ufeff"))).ReadAll()
	require.NoError(t, err)
	require.Equal(t, [][]string{
		{"id", "short_url", "slug", "target_url", "title", "tags", "status", "redirect_mode", "intermediate_delay_seconds", "expires_at", "password_enabled", "max_visits", "visits_used", "created_at", "updated_at", "owner_id", "owner_username"},
		{"id", "https://go.example/slug1", "slug1", "https://example.com/a,\"b\"\nc", "' \u2003=1", `["=formula","a,b"]`, "disabled", "confirmation", "5", "2026-10-24T04:34:56.000000123Z", "true", "123", "42", "2026-10-24T04:34:56.000000123Z", "2026-10-24T04:34:56.000000123Z", "owner-id", "'\towner"},
	}, rows)
	row.Tags = nil
	row.ExpiresAt = pgtype.Timestamptz{}
	row.MaxVisits = 0
	row.PasswordEnabled = false
	row.Title = "normal"
	result, err = listExportCSV([]sqlc.ExportShortLinkListRow{row}, true)
	require.NoError(t, err)
	require.Equal(t, "moeurl-links-all.csv", result.FileName)
	rows, err = csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Content, "\ufeff"))).ReadAll()
	require.NoError(t, err)
	require.Equal(t, "[]", rows[1][5])
	require.Empty(t, rows[1][9])
	require.Empty(t, rows[1][11])
	require.Equal(t, "false", rows[1][10])
	// Standard CSV quoting expands quotes; the byte cap applies to actual escaped bytes.
	row.TargetUrl = strings.Repeat(`"`, maxListExportBytes/2)
	result, err = listExportCSV([]sqlc.ExportShortLinkListRow{row}, false)
	require.ErrorIs(t, err, ErrListExportLimit)
	require.Empty(t, result.Content)
	// Exactly 8 MiB is allowed; one additional escaped UTF-8 byte must fail at final flush.
	row.TargetUrl = ""
	base, err := listExportCSV([]sqlc.ExportShortLinkListRow{row}, false)
	require.NoError(t, err)
	row.TargetUrl = strings.Repeat("x", maxListExportBytes-len(base.Content))
	result, err = listExportCSV([]sqlc.ExportShortLinkListRow{row}, false)
	require.NoError(t, err)
	require.Len(t, result.Content, maxListExportBytes)
	row.TargetUrl += "x"
	result, err = listExportCSV([]sqlc.ExportShortLinkListRow{row}, false)
	require.ErrorIs(t, err, ErrListExportLimit)
	require.Empty(t, result.Content)
	var bounded listExportBuffer
	n, err := bounded.Write([]byte(strings.Repeat("x", maxListExportBytes)))
	require.NoError(t, err)
	require.Equal(t, maxListExportBytes, n)
	n, err = bounded.Write([]byte("x"))
	require.Zero(t, n)
	require.ErrorIs(t, err, ErrListExportLimit)
	require.Equal(t, maxListExportBytes, bounded.buffer.Len())
}

type listExportReadFunc func(context.Context, sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error)

// ExportShortLinkList replaces only database I/O for deterministic failures and context checks.
func (f listExportReadFunc) ExportShortLinkList(ctx context.Context, input sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error) {
	return f(ctx, input)
}

// TestListExportFailures checks input, initial authorization, query failures and snapshot sentinel denial.
func TestListExportFailures(t *testing.T) {
	actor := auth.CurrentUser{ID: uuid.NewString(), GroupKey: "user"}
	queryErr := errors.New("database unavailable")
	reader := listExportReadFunc(func(context.Context, sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error) {
		return nil, queryErr
	})
	service := &Service{permissions: permission.NewService(), listExports: reader}
	_, err := service.ExportList(t.Context(), actor, ListExportInput{})
	require.ErrorIs(t, err, queryErr)
	for _, input := range []ListExportInput{{Status: "invalid"}, {Query: strings.Repeat("x", 201)}, {Tag: strings.Repeat("x", 33)}, {Query: "\x00"}, {Tag: "con\ntrol"}, {Query: string([]byte{255})}} {
		_, err = service.ExportList(t.Context(), actor, input)
		require.True(t, errors.Is(err, ErrInvalidInput) || errors.Is(err, ErrInvalidStatus))
	}
	invalid := actor
	invalid.ID = "malformed"
	_, err = service.ExportList(t.Context(), invalid, ListExportInput{})
	require.ErrorIs(t, err, ErrPermissionDenied)
	_, err = service.ExportList(t.Context(), auth.CurrentUser{GroupKey: "guest"}, ListExportInput{})
	require.ErrorIs(t, err, ErrPermissionDenied)
	service.permissions = failingPermissionResolver{err: queryErr}
	_, err = service.ExportList(t.Context(), actor, ListExportInput{})
	require.ErrorIs(t, err, queryErr)
	service.permissions = permission.NewService()
	for _, rows := range [][]sqlc.ExportShortLinkListRow{nil, {{Allowed: false}}, {{Allowed: false, LimitExceeded: true}}} {
		service.listExports = listExportReadFunc(func(context.Context, sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error) {
			return rows, nil
		})
		_, err = service.ExportList(t.Context(), actor, ListExportInput{})
		require.ErrorIs(t, err, ErrPermissionDenied)
	}
	for _, admin := range []bool{false, true} {
		start := time.Now()
		actor.GroupKey = "user"
		if admin {
			actor.GroupKey = "admin"
		}
		service.listExports = listExportReadFunc(func(ctx context.Context, input sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error) {
			deadline, ok := ctx.Deadline()
			require.True(t, ok)
			require.LessOrEqual(t, deadline.Sub(start), 5*time.Second+time.Millisecond)
			require.Greater(t, deadline.Sub(start), 4*time.Second)
			require.Equal(t, sqlc.ExportShortLinkListParams{ActorID: uuidToPgtype(uuid.MustParse(actor.ID)), IsAdmin: admin, Status: "disabled", Query: `100\%\_\\`, Tag: "Case"}, input)
			return []sqlc.ExportShortLinkListRow{{Allowed: true}}, nil
		})
		input := ListExportInput{Status: "disabled", Query: ` 100%_\ `, Tag: " Case "}
		var result ListExport
		if admin {
			result, err = service.AdminExportList(t.Context(), actor, input)
		} else {
			result, err = service.ExportList(t.Context(), actor, input)
		}
		require.NoError(t, err)
		require.Equal(t, 1, strings.Count(result.Content, "\r\n"))
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	service.listExports = listExportReadFunc(func(ctx context.Context, _ sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error) {
		return nil, ctx.Err()
	})
	_, err = service.ExportList(ctx, actor, ListExportInput{})
	require.ErrorIs(t, err, context.Canceled)
	shortDeadline := time.Now().Add(time.Second)
	ctx, cancel = context.WithDeadline(t.Context(), shortDeadline)
	defer cancel()
	service.listExports = listExportReadFunc(func(ctx context.Context, _ sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error) {
		deadline, _ := ctx.Deadline()
		require.Equal(t, shortDeadline, deadline)
		return []sqlc.ExportShortLinkListRow{{Allowed: true}}, nil
	})
	_, err = service.ExportList(ctx, actor, ListExportInput{})
	require.NoError(t, err)
}
