package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestShortLinkBatchNoteAppendHTTP catches missing production routes and writes that alter unrelated link fields.
func TestShortLinkBatchNoteAppendHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	var actorID string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&actorID))
	type linkVersion struct {
		id        string
		updatedAt string
		noteAt    string
	}
	links := make([]linkVersion, 4)
	for i := range links {
		var main, note time.Time
		require.NoError(t, a.pool.QueryRow(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
			select gen_random_uuid(),$1,d.id,$2,'https://example.com/append-note','active',now(),now() from domain d where is_default returning id::text,updated_at,note_updated_at`, actorID, fmt.Sprintf("appendnote%d", i)).Scan(&links[i].id, &main, &note))
		links[i].updatedAt = main.UTC().Format(time.RFC3339Nano)
		links[i].noteAt = note.UTC().Format(time.RFC3339Nano)
	}
	routes := []struct {
		name string
		path string
		link linkVersion
		body any
	}{
		{name: "own-preview", path: "/api/v1/short-link/note/batch-append/preview", link: links[0]},
		{name: "own-write", path: "/api/v1/short-link/note/batch-append", link: links[1]},
		{name: "admin-preview", path: "/api/v1/admin/short-link/note/batch-append/preview", link: links[2]},
		{name: "admin-write", path: "/api/v1/admin/short-link/note/batch-append", link: links[3]},
	}
	for i := range routes {
		item := map[string]string{"id": routes[i].link.id, "expectedUpdatedAt": routes[i].link.updatedAt}
		if routes[i].name == "own-preview" || routes[i].name == "admin-preview" {
			routes[i].body = map[string]any{"items": []any{item}, "note": "added"}
		} else {
			item["expectedNoteUpdatedAt"] = routes[i].link.noteAt
			routes[i].body = map[string]any{"requestId": fmt.Sprintf("00000000-0000-4000-8000-%012d", i+1), "items": []any{item}, "note": "added"}
		}
	}
	for routeIndex, route := range routes {
		t.Run(route.name, func(t *testing.T) {
			raw, err := json.Marshal(route.body)
			require.NoError(t, err)
			post := func(body []byte) *httptest.ResponseRecorder {
				t.Helper()
				r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, route.path, bytes.NewReader(body))
				r.Header.Set("Content-Type", "application/json")
				r.AddCookie(cookie)
				w := httptest.NewRecorder()
				a.server.Handler.ServeHTTP(w, r)
				return w
			}
			w := post(raw)
			require.Equal(t, http.StatusOK, w.Code, w.Body.String())
			require.Contains(t, w.Header().Get("Cache-Control"), "no-store")
			var result struct {
				Code int             `json:"code"`
				Data json.RawMessage `json:"data"`
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
			require.Zero(t, result.Code, w.Body.String())
			require.NotContains(t, w.Body.String(), `"note":`)
			if route.name == "own-preview" || route.name == "admin-preview" {
				var preview struct {
					Items           []map[string]string `json:"items"`
					AppendableCount int                 `json:"appendableCount"`
					OverflowCount   int                 `json:"overflowCount"`
				}
				require.NoError(t, json.Unmarshal(result.Data, &preview))
				require.Len(t, preview.Items, 1)
				require.Equal(t, 1, preview.AppendableCount)
				require.Zero(t, preview.OverflowCount)
				require.Equal(t, route.link.id, preview.Items[0]["id"])
				require.Equal(t, route.link.updatedAt, preview.Items[0]["expectedUpdatedAt"])
				require.Equal(t, route.link.noteAt, preview.Items[0]["expectedNoteUpdatedAt"])
				return
			}
			var appended struct {
				RequestID     string `json:"requestId"`
				AppendedCount int    `json:"appendedCount"`
			}
			require.NoError(t, json.Unmarshal(result.Data, &appended))
			require.Equal(t, route.body.(map[string]any)["requestId"], appended.RequestID)
			require.Equal(t, 1, appended.AppendedCount)
			replay := post(raw)
			require.Contains(t, replay.Body.String(), `"code":0`)
			changed := route.body.(map[string]any)
			changed["note"] = "different"
			conflictingRaw, err := json.Marshal(changed)
			require.NoError(t, err)
			conflict := post(conflictingRaw)
			require.Contains(t, conflict.Body.String(), `"code":200120`)
			var note string
			require.NoError(t, a.pool.QueryRow(t.Context(), `select note from short_link where id=$1`, route.link.id).Scan(&note))
			require.Equal(t, "added", note)
			changed["note"] = "added"
			main := route.link.updatedAt
			var noteVersion time.Time
			require.NoError(t, a.pool.QueryRow(t.Context(), `select note_updated_at from short_link where id=$1`, route.link.id).Scan(&noteVersion))
			item := route.body.(map[string]any)["items"].([]any)[0].(map[string]string)
			item["expectedNoteUpdatedAt"] = noteVersion.UTC().Format(time.RFC3339Nano)
			item["expectedUpdatedAt"] = main
			route.body.(map[string]any)["requestId"] = fmt.Sprintf("00000000-0000-4000-8000-%012d", routeIndex+100)
			repeatRaw, err := json.Marshal(route.body)
			require.NoError(t, err)
			repeated := post(repeatRaw)
			require.Contains(t, repeated.Body.String(), `"code":0`)
			require.NoError(t, a.pool.QueryRow(t.Context(), `select note from short_link where id=$1`, route.link.id).Scan(&note))
			require.Equal(t, "added\nadded", note)
		})
	}
	for _, link := range links {
		var main time.Time
		require.NoError(t, a.pool.QueryRow(t.Context(), `select updated_at from short_link where id=$1`, link.id).Scan(&main))
		require.Equal(t, link.updatedAt, main.UTC().Format(time.RFC3339Nano))
	}
}

func TestShortLinkBatchNoteAppendRejectsOverflowAtomically(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	var actorID string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&actorID))
	ids := make([]string, 2)
	for i := range ids {
		require.NoError(t, a.pool.QueryRow(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
			select gen_random_uuid(),$1,d.id,$2,'https://example.com/append-overflow','active',now(),now() from domain d where is_default returning id::text`, actorID, fmt.Sprintf("appendoverflow%d", i)).Scan(&ids[i]))
	}
	const privateOldNote = "private-existing-note"
	_, err := a.pool.Exec(t.Context(), `update short_link set note=$2 where id=$1`, ids[0], privateOldNote)
	require.NoError(t, err)
	longOldNote := strings.Repeat("x", 998)
	_, err = a.pool.Exec(t.Context(), `update short_link set note=$2 where id=$1`, ids[1], longOldNote)
	require.NoError(t, err)
	items := make([]map[string]string, len(ids))
	for i, id := range ids {
		var main, note time.Time
		require.NoError(t, a.pool.QueryRow(t.Context(), `select updated_at,note_updated_at from short_link where id=$1`, id).Scan(&main, &note))
		items[i] = map[string]string{"id": id, "expectedUpdatedAt": main.UTC().Format(time.RFC3339Nano), "expectedNoteUpdatedAt": note.UTC().Format(time.RFC3339Nano)}
	}
	post := func(path string, payload any) *httptest.ResponseRecorder {
		t.Helper()
		raw, marshalErr := json.Marshal(payload)
		require.NoError(t, marshalErr)
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, bytes.NewReader(raw))
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		a.server.Handler.ServeHTTP(w, r)
		return w
	}
	preview := post("/api/v1/short-link/note/batch-append/preview", map[string]any{"items": []map[string]string{{"id": ids[0], "expectedUpdatedAt": items[0]["expectedUpdatedAt"]}, {"id": ids[1], "expectedUpdatedAt": items[1]["expectedUpdatedAt"]}}, "note": "xy"})
	require.Equal(t, http.StatusOK, preview.Code)
	require.NotContains(t, preview.Body.String(), privateOldNote)
	require.NotContains(t, preview.Body.String(), longOldNote)
	require.Contains(t, preview.Body.String(), `"appendableCount":1`)
	require.Contains(t, preview.Body.String(), `"overflowCount":1`)
	write := post("/api/v1/short-link/note/batch-append", map[string]any{"requestId": "00000000-0000-4000-8000-000000000321", "items": items, "note": "xy"})
	require.Equal(t, http.StatusOK, write.Code)
	require.Contains(t, write.Body.String(), `"code":100001`)
	for i, want := range []string{privateOldNote, longOldNote} {
		var got string
		require.NoError(t, a.pool.QueryRow(t.Context(), `select note from short_link where id=$1`, ids[i]).Scan(&got))
		require.Equal(t, want, got)
	}
}
