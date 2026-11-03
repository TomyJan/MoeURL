package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestShortLinkNoteVersionHTTP catches lossy version parsing at the real Session/router/storage boundary.
func TestShortLinkNoteVersionHTTP(t *testing.T) {
	for _, scope := range []string{"own", "admin"} {
		t.Run(scope, func(t *testing.T) {
			a := newTestApplication(t)
			cookie := domainOrderLogin(t, a)
			var id, actorID string
			require.NoError(t, a.pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&actorID))
			require.NoError(t, a.pool.QueryRow(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at,note,note_updated_at)
				select gen_random_uuid(),$1,d.id,'noteversion','https://example.com/version','active',now(),now(),'original','2026-11-03T00:00:00.123456Z' from domain d where is_default returning id::text`, actorID).Scan(&id))
			prefix := "/api/v1/short-link"
			if scope == "admin" {
				prefix = "/api/v1/admin/short-link"
			}
			snapshot := func(withNote bool) string {
				t.Helper()
				query := `select jsonb_build_object('link',(select to_jsonb(s) from short_link s where id=$1),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from audit_log a))::text`
				if !withNote {
					query = `select (to_jsonb(s)-'note'-'note_updated_at')::text from short_link s where id=$1`
				}
				var value string
				require.NoError(t, a.pool.QueryRow(t.Context(), query, id).Scan(&value))
				return value
			}
			save := func(version, note string) (int, string) {
				t.Helper()
				payload := fmt.Sprintf(`{"id":%q,"note":%q,"expectedUpdatedAt":%q}`, id, note, version)
				r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, prefix+"/note/update", strings.NewReader(payload))
				r.Header.Set("Content-Type", "application/json")
				r.AddCookie(cookie)
				w := httptest.NewRecorder()
				a.server.Handler.ServeHTTP(w, r)
				require.Equal(t, http.StatusOK, w.Code, w.Body.String())
				var body struct {
					Code int
					Data struct{ UpdatedAt string }
				}
				require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
				return body.Code, body.Data.UpdatedAt
			}
			before, legacy := snapshot(true), snapshot(false)
			code, _ := save("2026-11-03T00:00:00.1234560001Z", "must not be saved")
			require.Equal(t, 100001, code, "extra precision must not be silently truncated into the current version")
			require.JSONEq(t, before, snapshot(true))
			code, _ = save("2026-11-03T00:00:00.123456001Z", "stale")
			require.Equal(t, 200116, code, "a legal version differing by one nanosecond must conflict")
			require.JSONEq(t, before, snapshot(true))
			code, unchanged := save("2026-11-03T08:00:00.123456+08:00", "original")
			require.Zero(t, code)
			require.Equal(t, "2026-11-03T00:00:00.123456Z", unchanged)
			require.JSONEq(t, before, snapshot(true))
			var oldAuditCount int
			require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&oldAuditCount))
			code, updated := save("2026-11-03T00:00:00.123456Z", "changed")
			require.Zero(t, code)
			parsed, err := time.Parse(time.RFC3339Nano, updated)
			require.NoError(t, err)
			require.True(t, parsed.After(time.Date(2026, 11, 3, 0, 0, 0, 123456000, time.UTC)))
			require.JSONEq(t, legacy, snapshot(false))
			var note, actualVersion, audit string
			require.NoError(t, a.pool.QueryRow(t.Context(), `select note,to_char(note_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from short_link where id=$1`, id).Scan(&note, &actualVersion))
			require.Equal(t, "changed", note)
			actual, err := time.Parse(time.RFC3339Nano, actualVersion)
			require.NoError(t, err)
			require.True(t, actual.Equal(parsed))
			var newAuditCount int
			require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&newAuditCount))
			require.Equal(t, oldAuditCount+1, newAuditCount)
			require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_build_object('actor',actor_id,'fields',changed_fields)::text from audit_log where changed_fields=array['note']`).Scan(&audit))
			require.JSONEq(t, `{"actor":"`+actorID+`","fields":["note"]}`, audit)
		})
	}
}
