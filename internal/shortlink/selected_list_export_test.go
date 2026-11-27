package shortlink

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
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

// TestSelectedListExportServiceInput catches direct callers bypassing the bounded, canonical selection contract.
func TestSelectedListExportServiceInput(t *testing.T) {
	const id = "00000000-0000-0000-0000-00000000e601"
	actor := auth.CurrentUser{ID: "00000000-0000-0000-0000-00000000e600", GroupKey: "user"}
	queryErr := errors.New("unexpected database boundary")
	service := &Service{permissions: permission.NewService(), listExports: listExportReadFunc(func(context.Context, sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error) {
		return nil, queryErr
	})}
	for _, ids := range [][]string{nil, {}, {""}, {"broken"}, {strings.ToUpper(id)}, {uuid.Nil.String()}, {strings.ReplaceAll(id, "-", "")}, {" " + id}, {id, id}, {string([]byte{255})}, make([]string, 101)} {
		for _, admin := range []bool{false, true} {
			input := SelectedListExportInput{IDs: ids}
			var result ListExport
			var err error
			if admin {
				result, err = service.AdminExportSelectedList(t.Context(), actor, input)
			} else {
				result, err = service.ExportSelectedList(t.Context(), actor, input)
			}
			require.ErrorIs(t, err, ErrInvalidInput)
			require.Empty(t, result.Content)
		}
	}
	_, err := service.ExportSelectedList(t.Context(), actor, SelectedListExportInput{IDs: []string{id}})
	require.ErrorIs(t, err, queryErr)
	_, err = service.ExportSelectedList(t.Context(), auth.GuestUser(), SelectedListExportInput{IDs: []string{id}})
	require.ErrorIs(t, err, ErrPermissionDenied)
	_, err = service.AdminExportSelectedList(t.Context(), actor, SelectedListExportInput{IDs: []string{id}})
	require.ErrorIs(t, err, ErrPermissionDenied)
}

// TestSelectedListExportServiceSnapshot catches wrong SQL mode, scope, deadlines and partial-success sentinel handling.
func TestSelectedListExportServiceSnapshot(t *testing.T) {
	actor := auth.CurrentUser{ID: "00000000-0000-0000-0000-00000000e600", GroupKey: "user"}
	for _, admin := range []bool{false, true} {
		for _, count := range []int{1, 100} {
			t.Run(fmt.Sprintf("admin=%v/count=%d", admin, count), func(t *testing.T) {
				user := actor
				if admin {
					user.GroupKey = "admin"
				}
				input := SelectedListExportInput{IDs: make([]string, count)}
				wantIDs := make([]pgtype.UUID, count)
				for i := range input.IDs {
					input.IDs[i] = fmt.Sprintf("00000000-0000-0000-0000-%012d", i+1)
					wantIDs[i] = pgtype.UUID{Bytes: uuid.MustParse(input.IDs[i]), Valid: true}
				}
				service := &Service{permissions: permission.NewService()}
				run := service.ExportSelectedList
				name := "moeurl-links-own-selected.csv"
				if admin {
					run = service.AdminExportSelectedList
					name = "moeurl-links-all-selected.csv"
				}
				service.listExports = listExportReadFunc(func(ctx context.Context, p sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error) {
					deadline, exists := ctx.Deadline()
					require.True(t, exists)
					require.InDelta(t, 5, time.Until(deadline).Seconds(), 0.2)
					require.Equal(t, sqlc.ExportShortLinkListParams{PermissionGranted: true, ActorID: pgtype.UUID{Bytes: uuid.MustParse(actor.ID), Valid: true}, IsAdmin: admin, SelectionMode: true, SelectedIds: wantIDs}, p)
					return []sqlc.ExportShortLinkListRow{{Allowed: true, ID: input.IDs[0], DomainHost: "go.example", Slug: "selected", TargetUrl: "https://example.com/target", Title: "=formula", Tags: []string{}, Status: "active", RedirectMode: "direct", OwnerID: actor.ID, OwnerUsername: "owner"}}, nil
				})
				result, err := run(t.Context(), user, input)
				require.NoError(t, err)
				require.Equal(t, name, result.FileName)
				require.Equal(t, "text/csv;charset=utf-8", result.ContentType)
				records, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Content, "\ufeff"))).ReadAll()
				require.NoError(t, err)
				require.Equal(t, "'=formula", records[1][4])
				for _, rows := range [][]sqlc.ExportShortLinkListRow{nil, {{Allowed: false}}, {{Allowed: true, SelectionUnavailable: true}}, {{Allowed: true, SelectionUnavailable: true, LimitExceeded: true}}} {
					service.listExports = listExportReadFunc(func(context.Context, sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error) {
						return rows, nil
					})
					result, err = run(t.Context(), user, input)
					require.ErrorIs(t, err, ErrPermissionDenied)
					require.Empty(t, result.Content)
				}
				service.listExports = listExportReadFunc(func(context.Context, sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error) {
					return []sqlc.ExportShortLinkListRow{{Allowed: true, LimitExceeded: true}}, nil
				})
				result, err = run(t.Context(), user, input)
				require.ErrorIs(t, err, ErrListExportLimit)
				require.Empty(t, result.Content)
				ctx, cancel := context.WithCancel(t.Context())
				cancel()
				service.listExports = listExportReadFunc(func(ctx context.Context, _ sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error) {
					return nil, ctx.Err()
				})
				result, err = run(ctx, user, input)
				require.ErrorIs(t, err, context.Canceled)
				require.Empty(t, result.Content)
			})
		}
	}
}
