package app

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestShortLinkBatchNoteReplaceHTTP catches missing production wiring and writes that change list revisions or expose old notes.
func TestShortLinkBatchNoteReplaceHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	var actorID string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&actorID))
	var ids, versions []string
	for i := range 3 {
		var id string
		var version time.Time
		require.NoError(t, a.pool.QueryRow(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
			select gen_random_uuid(),$1,d.id,$2,'https://example.com/replace-note','active',now(),now() from domain d where is_default returning id::text,updated_at`, actorID, fmt.Sprintf("replacenote%d", i)).Scan(&id, &version))
		ids = append(ids, id)
		versions = append(versions, version.UTC().Format(time.RFC3339Nano))
	}
	post := func(path string, payload any) *httptest.ResponseRecorder {
		t.Helper()
		raw, err := json.Marshal(payload)
		require.NoError(t, err)
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(string(raw)))
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		a.server.Handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		return w
	}
	for _, prefix := range []string{"/api/v1/short-link/note/batch-replace", "/api/v1/admin/short-link/note/batch-replace"} {
		for i, note := range []string{"old-private-canary-猫😀", "new", ""} {
			_, err := a.pool.Exec(t.Context(), `update short_link set note=$2 where id=$1`, ids[i], note)
			require.NoError(t, err)
		}
		selected := make([]map[string]string, 3)
		for i, id := range ids {
			selected[i] = map[string]string{"id": id, "expectedUpdatedAt": versions[i]}
		}
		w := post(prefix+"/preview", map[string]any{"items": selected, "note": " \r\nnew\t "})
		var preview struct {
			Code int `json:"code"`
			Data struct {
				Items []struct {
					ID                    string `json:"id"`
					ExpectedUpdatedAt     string `json:"expectedUpdatedAt"`
					ExpectedNoteUpdatedAt string `json:"expectedNoteUpdatedAt"`
					WillChange            bool   `json:"willChange"`
				} `json:"items"`
				ChangedCount   int `json:"changedCount"`
				UnchangedCount int `json:"unchangedCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &preview))
		require.Zero(t, preview.Code, "replace preview must be served by the production router")
		require.Contains(t, w.Header().Get("Cache-Control"), "no-store")
		require.NotContains(t, w.Body.String(), "old-private-canary")
		require.NotContains(t, w.Body.String(), `"note":`)
		require.Equal(t, 2, preview.Data.ChangedCount)
		require.Equal(t, 1, preview.Data.UnchangedCount)
		require.Len(t, preview.Data.Items, 3)
		for i, item := range preview.Data.Items {
			require.Equal(t, ids[i], item.ID)
			require.Equal(t, versions[i], item.ExpectedUpdatedAt)
			require.Equal(t, i != 1, item.WillChange)
			_, err := time.Parse(time.RFC3339Nano, item.ExpectedNoteUpdatedAt)
			require.NoError(t, err)
			selected[i]["expectedNoteUpdatedAt"] = item.ExpectedNoteUpdatedAt
		}
		w = post(prefix, map[string]any{"items": selected, "note": "new"})
		var result struct {
			Code int `json:"code"`
			Data struct {
				ChangedCount   int `json:"changedCount"`
				UnchangedCount int `json:"unchangedCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Zero(t, result.Code)
		require.Equal(t, 2, result.Data.ChangedCount)
		require.Equal(t, 1, result.Data.UnchangedCount)
		require.NotContains(t, w.Body.String(), `"note":`)
		for i, id := range ids {
			var note string
			var main, revision time.Time
			require.NoError(t, a.pool.QueryRow(t.Context(), `select note,updated_at,note_updated_at from short_link where id=$1`, id).Scan(&note, &main, &revision))
			require.Equal(t, "new", note)
			require.Equal(t, versions[i], main.UTC().Format(time.RFC3339Nano))
			if i == 1 {
				require.Equal(t, selected[i]["expectedNoteUpdatedAt"], revision.UTC().Format(time.RFC3339Nano))
			} else {
				require.NotEqual(t, selected[i]["expectedNoteUpdatedAt"], revision.UTC().Format(time.RFC3339Nano))
			}
		}
	}
	// Store a distinctive replacement through the new write path, then inspect unrelated public/list/export responses.
	const canary = "replacement-private-canary-猫😀"
	selected := make([]map[string]string, len(ids))
	for i, id := range ids {
		selected[i] = map[string]string{"id": id, "expectedUpdatedAt": versions[i]}
	}
	w := post("/api/v1/short-link/note/batch-replace/preview", map[string]any{"items": selected, "note": canary})
	var preview struct {
		Code int `json:"code"`
		Data struct {
			Items []struct {
				ID   string `json:"id"`
				Main string `json:"expectedUpdatedAt"`
				Note string `json:"expectedNoteUpdatedAt"`
			} `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &preview))
	require.Zero(t, preview.Code)
	for i, item := range preview.Data.Items {
		selected[i] = map[string]string{"id": item.ID, "expectedUpdatedAt": item.Main, "expectedNoteUpdatedAt": item.Note}
	}
	w = post("/api/v1/short-link/note/batch-replace", map[string]any{"items": selected, "note": canary})
	require.Contains(t, w.Body.String(), `"code":0`)
	var domainHost string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select d.host from domain d join short_link s on s.domain_id=d.id where s.id=$1`, ids[0]).Scan(&domainHost))
	parsed, err := url.Parse(domainHost)
	require.NoError(t, err)
	if parsed.Host != "" {
		domainHost = parsed.Host
	}
	// Preview applies to an interactive link; keep another direct link for the real target 302.
	_, err = a.pool.Exec(t.Context(), `update short_link set redirect_mode='confirmation' where id=$1`, ids[2])
	require.NoError(t, err)
	for _, path := range []string{"/api/v1/short-link/list", "/api/v1/admin/short-link/list", "/api/v1/short-link/export", "/api/v1/admin/short-link/export", "/go/replacenote2/preview", "/replacenote0"} {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		r.Host = domainHost
		if strings.HasPrefix(path, "/api/") {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		a.server.Handler.ServeHTTP(w, r)
		require.NotContains(t, w.Body.String(), canary)
		require.NotContains(t, w.Body.String(), "old-private-canary")
		require.NotContains(t, w.Body.String(), `"note":`)
		require.NotContains(t, w.Body.String(), "noteUpdatedAt")
		if path == "/replacenote0" {
			require.Equal(t, http.StatusFound, w.Code)
			require.Equal(t, "https://example.com/replace-note", w.Header().Get("Location"))
		} else {
			require.Equal(t, http.StatusOK, w.Code, w.Body.String())
			if strings.HasPrefix(path, "/go/") {
				require.Contains(t, w.Body.String(), "replacenote2")
			} else {
				require.Contains(t, w.Body.String(), "replacenote0")
			}
			if strings.HasSuffix(path, "/export") {
				var download struct {
					Code int `json:"code"`
					Data struct {
						ContentType string `json:"contentType"`
						Content     string `json:"content"`
					} `json:"data"`
				}
				require.NoError(t, json.Unmarshal(w.Body.Bytes(), &download))
				require.Zero(t, download.Code)
				require.Contains(t, download.Data.ContentType, "text/csv")
				records, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(download.Data.Content, "\ufeff"))).ReadAll()
				require.NoError(t, err)
				require.Len(t, records, 4)
				require.NotContains(t, records[0], "note")
				require.NotContains(t, records[0], "note_updated_at")
				require.NotContains(t, download.Data.Content, canary)
			} else {
				require.Contains(t, w.Body.String(), `"code":0`)
			}
		}
	}
}
