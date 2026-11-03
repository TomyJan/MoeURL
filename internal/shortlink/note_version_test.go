package shortlink_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/TomyJan/MoeURL/internal/shortlink"
)

// TestNoteVersionCorpus catches both permissive syntax and precision/range loss through the public service.
func TestNoteVersionCorpus(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/short-link-note-versions.json")
	require.NoError(t, err)
	var corpus []struct {
		ID    string `json:"id"`
		Input string `json:"input"`
		Valid bool   `json:"valid"`
	}
	require.NoError(t, json.Unmarshal(raw, &corpus))
	for _, adminScope := range []bool{false, true} {
		scope := "own"
		if adminScope {
			scope = "admin"
		}
		t.Run(scope, func(t *testing.T) {
			pool, service, admin, owner, _, input := noteFixture(t)
			_, err := pool.Exec(t.Context(), `update short_link set note_updated_at='2030-06-15T12:34:56.654321Z' where id=$1`, input.ID)
			require.NoError(t, err)
			snapshot := func() string {
				var value string
				require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_build_object('link',(select to_jsonb(s) from short_link s where id=$1),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from audit_log a))::text`, input.ID).Scan(&value))
				return value
			}
			before := snapshot()
			for _, item := range corpus {
				t.Run(item.ID, func(t *testing.T) {
					request := input
					request.ExpectedUpdatedAt = item.Input
					want := shortlink.ErrInvalidInput
					if item.Valid {
						want = shortlink.ErrTransferConflict
					}
					if adminScope {
						_, err = service.UpdateAdminNote(t.Context(), admin, request)
					} else {
						_, err = service.UpdateOwnNote(t.Context(), owner, request)
					}
					require.ErrorIs(t, err, want)
					require.JSONEq(t, before, snapshot())
				})
			}
		})
	}
}
