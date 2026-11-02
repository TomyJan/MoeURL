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

// TestShortLinkNoteHTTP catches missing production wiring, lost notes, stale overwrites and public DTO leakage.
func TestShortLinkNoteHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	var id, actorID string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&actorID))
	require.NoError(t, a.pool.QueryRow(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
		select gen_random_uuid(),$1,d.id,'notewiring','https://example.com/note','active',now(),now() from domain d where is_default returning id::text`, actorID).Scan(&id))
	type note struct {
		ID        string `json:"id"`
		Note      string `json:"note"`
		UpdatedAt string `json:"updatedAt"`
	}
	request := func(method, path, payload string, session *http.Cookie) (int, note) {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(payload))
		r.Header.Set("Content-Type", "application/json")
		if session != nil {
			r.AddCookie(session)
		}
		w := httptest.NewRecorder()
		a.server.Handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var body struct {
			Code int  `json:"code"`
			Data note `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		if body.Code == 0 {
			require.Contains(t, w.Header().Get("Cache-Control"), "no-store")
		}
		return body.Code, body.Data
	}
	for _, prefix := range []string{"/api/v1/short-link", "/api/v1/admin/short-link"} {
		code, original := request(http.MethodGet, prefix+"/note?id="+id, "", cookie)
		require.Zero(t, code, "notes must be wired through the production router")
		require.Equal(t, id, original.ID)
		_, err := time.Parse(time.RFC3339Nano, original.UpdatedAt)
		require.NoError(t, err)
		payload := fmt.Sprintf(`{"id":%q,"note":"  private\r\n猫😀  ","expectedUpdatedAt":%q}`, id, original.UpdatedAt)
		code, saved := request(http.MethodPost, prefix+"/note/update", payload, cookie)
		require.Zero(t, code)
		require.Equal(t, "private\n猫😀", saved.Note)
		code, _ = request(http.MethodPost, prefix+"/note/update", payload, cookie)
		require.Equal(t, 200116, code, "a stale same-value save must still conflict")
		code, _ = request(http.MethodGet, prefix+"/note?id="+id, "", nil)
		require.Equal(t, 120001, code)
		code, cleared := request(http.MethodPost, prefix+"/note/update", fmt.Sprintf(`{"id":%q,"note":"","expectedUpdatedAt":%q}`, id, saved.UpdatedAt), cookie)
		require.Zero(t, code)
		require.Empty(t, cleared.Note)
	}
}
