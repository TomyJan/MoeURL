package user_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/stretchr/testify/require"
)

// Malformed documents, stale owner intent and oversized trailing data cannot mutate storage.
func TestListPreferenceStrictDocument(t *testing.T) {
	s, pool, actor, other := listPreferenceFixture(t)
	sessions := auth.NewSessionService(pool, time.Hour)
	session, err := sessions.Create(t.Context(), actor.ID)
	require.NoError(t, err)
	otherSession, err := sessions.Create(t.Context(), other.ID)
	require.NoError(t, err)
	h := user.NewListPreferenceHandler(s, nil)
	var expectedIdentity []string
	request := func(method, path, body, media, token string, want int) json.RawMessage {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", media)
		for _, value := range expectedIdentity {
			r.Header.Add("X-MoeURL-Expected-User-ID", value)
		}
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		w := httptest.NewRecorder()
		endpoint := http.HandlerFunc(h.Get)
		if method == http.MethodPost {
			endpoint = h.Update
		}
		auth.CurrentUserMiddleware(auth.NewService(pool, time.Hour))(endpoint).ServeHTTP(w, r)
		require.Equal(t, 200, w.Code, w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var result struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Equal(t, want, result.Code, w.Body.String())
		return result.Data
	}
	const path = "/api/v1/user/list-preference"
	const valid = `{"pageSize":null,"expectedUpdatedAt":null}`
	request(http.MethodGet, path, "", "", "", 120001)
	request(http.MethodPost, path+"/update", valid, "application/json", "", 120001)
	for _, suffix := range []string{"?", "?userId=other", "?x=%zz"} {
		request(http.MethodGet, path+suffix, "", "", session.ID, 100001)
		request(http.MethodPost, path+"/update"+suffix, valid, "application/json", session.ID, 100001)
	}
	for _, body := range []string{"", `null`, `[]`, `{}`, `{"`, `{"pageSize":`, `{"pageSize":null}`, `{"expectedUpdatedAt":null}`, `{"pageSize":null,"expectedUpdatedAt":null`, `{"pageSize":null,"expectedUpdatedAt":null,}`, `{"pageSize":[],"expectedUpdatedAt":null}`, `{"pageSize":null,"expectedUpdatedAt":{}}`, `{"PageSize":null,"expectedUpdatedAt":null}`, `{"pageSize":null,"pageSize":null,"expectedUpdatedAt":null}`, `{"pageSize":null,"page\u0053ize":null,"expectedUpdatedAt":null}`, `{"pageSize":null,"expectedUpdatedAt":null,"expectedUpdatedAt":null}`, `{"pageSize":null,"expectedUpdatedAt":null,"userId":"other"}`, valid + `{}`, valid + `garbage`, valid + strings.Repeat(" ", 8193)} {
		request(http.MethodPost, path+"/update", body, "application/json", session.ID, 100001)
	}
	for _, size := range []string{`"20"`, `20.0`, `20e0`, `true`, `0`, `-20`, `21`, `101`, `32768`} {
		request(http.MethodPost, path+"/update", fmt.Sprintf(`{"pageSize":%s,"expectedUpdatedAt":null}`, size), "application/json", session.ID, 100001)
	}
	for _, version := range []string{"bad", "0001-01-01T00:00:00Z", "2026-13-01T00:00:00Z", "2026-01-01T00:00:00.1234567891Z", "10000-01-01T00:00:00Z"} {
		request(http.MethodPost, path+"/update", fmt.Sprintf(`{"pageSize":null,"expectedUpdatedAt":%q}`, version), "application/json", session.ID, 100001)
	}
	for _, media := range []string{"", "text/plain", "application/json; broken"} {
		request(http.MethodPost, path+"/update", valid, media, session.ID, 100001)
	}
	for _, expected := range [][]string{{other.ID}, {""}, {actor.ID, actor.ID}} {
		expectedIdentity = expected
		request(http.MethodGet, path, "", "", session.ID, 120001)
		request(http.MethodPost, path+"/update", valid, "application/json", session.ID, 120001)
	}
	expectedIdentity = []string{actor.ID}
	request(http.MethodGet, path, "", "", session.ID, 0)
	expectedIdentity = nil
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from user_list_preference`).Scan(&count))
	require.Zero(t, count)
	first := request(http.MethodPost, path+"/update", valid+strings.Repeat(" ", 8192-len(valid)), "application/json; charset=utf-8", session.ID, 0)
	var doc struct {
		Preference struct {
			UpdatedAt string `json:"updatedAt"`
		} `json:"preference"`
	}
	require.NoError(t, json.Unmarshal(first, &doc))
	request(http.MethodPost, path+"/update", valid, "application/json", session.ID, 300104)
	replacement := fmt.Sprintf(`{"pageSize":100,"expectedUpdatedAt":%q}`, doc.Preference.UpdatedAt)
	request(http.MethodPost, path+"/update", replacement+strings.Repeat(" ", 8193-len(replacement)), "application/json", session.ID, 100001)
	require.JSONEq(t, string(first), string(request(http.MethodGet, path, "", "", session.ID, 0)))
	request(http.MethodPost, path+"/update", replacement, "application/json", session.ID, 0)
	require.JSONEq(t, `{"preference":{"pageSize":null,"updatedAt":null}}`, string(request(http.MethodGet, path, "", "", otherSession.ID, 0)))
	expectedIdentity = []string{actor.ID}
	request(http.MethodPost, path+"/update", valid, "application/json", otherSession.ID, 120001)
	_, err = pool.Exec(t.Context(), `update app_user set status='disabled' where id=$1`, actor.ID)
	require.NoError(t, err)
	request(http.MethodGet, path, "", "", session.ID, 120001)
	request(http.MethodPost, path+"/update", valid, "application/json", session.ID, 120001)
}

// Real database failures expose neither private relation names nor diagnostic text.
func TestListPreferenceInfrastructureRedaction(t *testing.T) {
	s, pool, actor, _ := listPreferenceFixture(t)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), actor.ID)
	require.NoError(t, err)
	var logs bytes.Buffer
	h := user.NewListPreferenceHandler(s, slog.New(slog.NewJSONHandler(&logs, nil)))
	_, err = pool.Exec(t.Context(), `alter table user_list_preference rename to private_list_secret`)
	require.NoError(t, err)
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		r := httptest.NewRequestWithContext(t.Context(), method, "/", strings.NewReader(`{"pageSize":null,"expectedUpdatedAt":null}`))
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session.ID})
		w := httptest.NewRecorder()
		endpoint := http.HandlerFunc(h.Get)
		if method == http.MethodPost {
			endpoint = h.Update
		}
		auth.CurrentUserMiddleware(auth.NewService(pool, time.Hour))(endpoint).ServeHTTP(w, r)
		require.Equal(t, 500, w.Code)
		require.Contains(t, w.Body.String(), `"code":900000`)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		require.NotContains(t, w.Body.String()+logs.String(), "user_list_preference")
		require.NotContains(t, w.Body.String()+logs.String(), "private_list_secret")
	}
	require.Contains(t, logs.String(), "list_preference_failed")
	require.Contains(t, logs.String(), "error_type")
}
