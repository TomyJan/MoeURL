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

// TestShortLinkBatchTagRenameHTTP catches missing production wiring and destructive tag replacement.
func TestShortLinkBatchTagRenameHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	var actorID string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&actorID))
	for routeIndex, route := range []string{"/api/v1/short-link/batch-tag-rename", "/api/v1/admin/short-link/batch-tag-rename"} {
		t.Run(fmt.Sprint(routeIndex), func(t *testing.T) {
			initial := [][]string{{"old", "other"}, {"old", "other", "new"}, {"other", "new"}}
			want := [][]string{{"new", "other"}, {"other", "new"}, {"other", "new"}}
			items := make([]map[string]string, len(initial))
			for i, tags := range initial {
				var id string
				var version time.Time
				require.NoError(t, a.pool.QueryRow(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,tags,note,created_at,updated_at)
					select gen_random_uuid(),$1,d.id,$2,'https://example.com/rename','active',$3,'private-unchanged',now(),now() from domain d where is_default returning id::text,updated_at`, actorID, fmt.Sprintf("tagrename%d%d", routeIndex, i), tags).Scan(&id, &version))
				items[i] = map[string]string{"id": id, "expectedUpdatedAt": version.UTC().Format(time.RFC3339Nano)}
			}
			raw, err := json.Marshal(map[string]any{"items": items, "fromTag": "old", "toTag": "new"})
			require.NoError(t, err)
			r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, route, strings.NewReader(string(raw)))
			r.Header.Set("Content-Type", "application/json")
			r.AddCookie(cookie)
			w := httptest.NewRecorder()
			a.server.Handler.ServeHTTP(w, r)
			require.Equal(t, http.StatusOK, w.Code, w.Body.String())
			var result struct {
				Code int `json:"code"`
				Data struct {
					ChangedCount   int `json:"changedCount"`
					UnchangedCount int `json:"unchangedCount"`
				} `json:"data"`
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
			require.Zero(t, result.Code, "production endpoint must rename the fixed batch")
			require.Equal(t, 2, result.Data.ChangedCount)
			require.Equal(t, 1, result.Data.UnchangedCount)
			require.Contains(t, w.Header().Get("Cache-Control"), "no-store")
			require.NotContains(t, w.Body.String(), "private-unchanged")
			for i, item := range items {
				var tags []string
				var note, target string
				var version time.Time
				require.NoError(t, a.pool.QueryRow(t.Context(), `select tags,note,target_url,updated_at from short_link where id=$1`, item["id"]).Scan(&tags, &note, &target, &version))
				require.Equal(t, want[i], tags)
				require.Equal(t, "private-unchanged", note)
				require.Equal(t, "https://example.com/rename", target)
				if i == 2 {
					require.Equal(t, item["expectedUpdatedAt"], version.UTC().Format(time.RFC3339Nano))
				} else {
					require.NotEqual(t, item["expectedUpdatedAt"], version.UTC().Format(time.RFC3339Nano))
				}
			}
		})
	}
}
