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

// TestShortLinkBatchNoteClearHTTP exercises the real session, production routes and private-note storage.
func TestShortLinkBatchNoteClearHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	var actorID string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&actorID))
	var ids, versions []string
	for i, note := range []string{"batch-private-canary-猫😀", ""} {
		var id string
		var version time.Time
		require.NoError(t, a.pool.QueryRow(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,note,created_at,updated_at)
			select gen_random_uuid(),$1,d.id,$2,'https://example.com/batch-note','active',$3,now(),now() from domain d where is_default returning id::text,updated_at`, actorID, fmt.Sprintf("batchnote%d", i), note).Scan(&id, &version))
		ids = append(ids, id)
		versions = append(versions, version.UTC().Format(time.RFC3339Nano))
	}
	post := func(path, payload string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(payload))
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		a.server.Handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		return w
	}
	for _, prefix := range []string{"/api/v1/short-link/note/batch-clear", "/api/v1/admin/short-link/note/batch-clear"} {
		// Reset between scopes; both production paths must perform real writes.
		require.NoError(t, execBatchNoteReset(t, a, ids[0]))
		payload := fmt.Sprintf(`{"items":[{"id":%q,"expectedUpdatedAt":%q},{"id":%q,"expectedUpdatedAt":%q}]}`, ids[0], versions[0], ids[1], versions[1])
		w := post(prefix+"/preview", payload)
		var body struct {
			Code int `json:"code"`
			Data struct {
				Items []struct {
					ID                    string `json:"id"`
					ExpectedUpdatedAt     string `json:"expectedUpdatedAt"`
					ExpectedNoteUpdatedAt string `json:"expectedNoteUpdatedAt"`
					HasNote               bool   `json:"hasNote"`
				} `json:"items"`
				NonemptyCount int `json:"nonemptyCount"`
				EmptyCount    int `json:"emptyCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Zero(t, body.Code, "batch note preview must be wired through the production router")
		require.Contains(t, w.Header().Get("Cache-Control"), "no-store")
		require.NotContains(t, w.Body.String(), "batch-private-canary")
		require.NotContains(t, w.Body.String(), `"note":`)
		require.Equal(t, 1, body.Data.NonemptyCount)
		require.Equal(t, 1, body.Data.EmptyCount)
		require.Len(t, body.Data.Items, 2)
		items := make([]map[string]string, 2)
		for i, item := range body.Data.Items {
			require.Equal(t, ids[i], item.ID)
			require.Equal(t, i == 0, item.HasNote)
			mainVersion, err := time.Parse(time.RFC3339Nano, item.ExpectedUpdatedAt)
			require.NoError(t, err)
			require.Equal(t, versions[i], mainVersion.UTC().Format(time.RFC3339Nano))
			_, err = time.Parse(time.RFC3339Nano, item.ExpectedNoteUpdatedAt)
			require.NoError(t, err)
			items[i] = map[string]string{"id": item.ID, "expectedUpdatedAt": versions[i], "expectedNoteUpdatedAt": item.ExpectedNoteUpdatedAt}
		}
		clearPayload, err := json.Marshal(map[string]any{"items": items})
		require.NoError(t, err)
		w = post(prefix, string(clearPayload))
		var cleared struct {
			Code int `json:"code"`
			Data struct {
				ChangedCount   int `json:"changedCount"`
				UnchangedCount int `json:"unchangedCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &cleared))
		require.Zero(t, cleared.Code)
		require.Equal(t, 1, cleared.Data.ChangedCount)
		require.Equal(t, 1, cleared.Data.UnchangedCount)
		for i, id := range ids {
			var note string
			var main time.Time
			require.NoError(t, a.pool.QueryRow(t.Context(), `select note,updated_at from short_link where id=$1`, id).Scan(&note, &main))
			require.Empty(t, note)
			require.Equal(t, versions[i], main.UTC().Format(time.RFC3339Nano))
		}
	}
}

func execBatchNoteReset(t *testing.T, a *App, id string) error {
	t.Helper()
	_, err := a.pool.Exec(t.Context(), `update short_link set note='batch-private-canary-猫😀' where id=$1`, id)
	return err
}
