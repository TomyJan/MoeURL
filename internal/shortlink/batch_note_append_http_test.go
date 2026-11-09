package shortlink_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestBatchNoteAppendHTTPContract catches wrong scope dispatch, leaked text, permissive framing and duplicate writes on replay.
func TestBatchNoteAppendHTTPContract(t *testing.T) {
	pool, service, admin, owner, selected := batchNoteFixture(t)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), ShortLinkBatchNoteAppend: service})
	call := func(path, body, token string, headers http.Header, want int) json.RawMessage {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), "POST", path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		for key, values := range headers {
			r.Header[key] = values
		}
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code, w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		require.NotContains(t, w.Body.String(), "private-canary")
		require.NotContains(t, w.Body.String(), `"note":`)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, want, response.Code, w.Body.String())
		return response.Data
	}
	for _, scope := range []struct {
		prefix string
		actor  auth.CurrentUser
	}{
		{"/api/v1/short-link/note/batch-append", owner},
		{"/api/v1/admin/short-link/note/batch-append", admin},
	} {
		session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), scope.actor.ID)
		require.NoError(t, err)
		previewBody, err := json.Marshal(shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "http-added"})
		require.NoError(t, err)
		var preview shortlink.BatchNoteAppendPreviewResult
		require.NoError(t, json.Unmarshal(call(scope.prefix+"/preview", string(previewBody), session.ID, http.Header{"X-Moeurl-Expected-User-Id": {scope.actor.ID}}, 0), &preview))
		require.Len(t, preview.Items, 3)
		require.Equal(t, 3, preview.AppendableCount)
		input := batchNoteAppendInput(preview, "http-added", uuid.NewString())
		body, err := json.Marshal(input)
		require.NoError(t, err)
		var result shortlink.BatchNoteAppendResult
		require.NoError(t, json.Unmarshal(call(scope.prefix, string(body), session.ID, nil, 0), &result))
		require.Equal(t, shortlink.BatchNoteAppendResult{RequestID: input.RequestID, AppendedCount: 3}, result)
		after := batchTagsSnapshot(t, pool)
		call(scope.prefix, string(body), session.ID, nil, 0)
		require.JSONEq(t, after, batchTagsSnapshot(t, pool))
		call(scope.prefix, strings.Replace(string(body), "http-added", "different", 1), session.ID, nil, 200120)
		for _, endpoint := range []struct{ path, body string }{{scope.prefix + "/preview", string(previewBody)}, {scope.prefix, string(body)}} {
			call(endpoint.path, endpoint.body, "", nil, 120001)
			call(endpoint.path, endpoint.body, session.ID, http.Header{"X-Moeurl-Expected-User-Id": {uuid.NewString()}}, 120001)
			call(endpoint.path, endpoint.body, session.ID, http.Header{"Content-Type": {"text/plain"}}, 100001)
			call(endpoint.path+"?", endpoint.body, session.ID, nil, 100001)
			call(endpoint.path, `{"items":null}`, session.ID, nil, 100001)
		}
	}
	var note string
	require.NoError(t, pool.QueryRow(t.Context(), `select note from short_link where id=$1`, selected.Items[0].ID).Scan(&note))
	require.Equal(t, "private-canary-猫😀\nhttp-added\nhttp-added", note)
	var audits, receipts int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where changed_fields=array['note']`).Scan(&audits))
	require.Equal(t, 6, audits)
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link_note_append_batch`).Scan(&receipts))
	require.Equal(t, 2, receipts)
}

// TestBatchNoteAppendDefaultLoggerStorageFailure verifies that an optional logger never turns a private storage error into a panic or leaked response.
func TestBatchNoteAppendDefaultLoggerStorageFailure(t *testing.T) {
	pool, service, _, owner, selected := batchNoteFixture(t)
	p, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "private-new-text"})
	require.NoError(t, err)
	body, err := json.Marshal(batchNoteAppendInput(p, "private-new-text", uuid.NewString()))
	require.NoError(t, err)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), owner.ID)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `alter table short_link rename column note to private_storage_canary`)
	require.NoError(t, err)
	handler := auth.CurrentUserMiddleware(auth.NewService(pool, time.Hour))(http.HandlerFunc(shortlink.NewBatchNoteAppendHandler(service, nil).AppendOwn))
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(string(body)))
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session.ID})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	require.Equal(t, 500, w.Code)
	require.Contains(t, w.Body.String(), `"code":900000`)
	require.NotContains(t, w.Body.String(), "private_storage_canary")
	require.NotContains(t, w.Body.String(), "private-new-text")
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
}
