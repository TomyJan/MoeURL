package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/stretchr/testify/require"
)

// TestRedirectPreferenceProtocol detects missing routes, lost persistence,
// account leakage and accidental writes to the three older preference resources.
func TestRedirectPreferenceProtocol(t *testing.T) {
	application := newTestApplication(t)
	admin := domainOrderLogin(t, application)
	const otherID = "00000000-0000-0000-0000-000000000391"
	_, err := application.pool.Exec(t.Context(), `insert into app_user(id,username,password_hash,nickname,group_id,status,builtin,created_at,updated_at)
		select $1,'redirect-other',password_hash,'Other',group_id,'active',false,now(),now() from app_user where username='admin'`, otherID)
	require.NoError(t, err)
	session, err := auth.NewSessionService(application.pool, time.Hour).Create(t.Context(), otherID)
	require.NoError(t, err)
	other := &http.Cookie{Name: auth.SessionCookieName, Value: session.ID}
	const snapshot = `select jsonb_build_object('users',(select jsonb_agg(to_jsonb(u) order by id) from app_user u),
		'interface',(select jsonb_agg(to_jsonb(p) order by user_id) from user_preference p),
		'domain',(select jsonb_agg(to_jsonb(p) order by user_id) from user_domain_preference p),
		'timezone',(select jsonb_agg(to_jsonb(p) order by user_id) from user_time_zone_preference p))::text`
	var before, after string
	require.NoError(t, application.pool.QueryRow(t.Context(), snapshot).Scan(&before))
	const path = "/api/v1/user/redirect-preference"
	unset := domainOrderRequest(t, application, admin, http.MethodGet, path, "")
	require.JSONEq(t, `{"preference":{"redirectMode":null,"updatedAt":null}}`, string(unset))
	saved := domainOrderRequest(t, application, admin, http.MethodPost, path+"/update", `{"redirectMode":"confirmation","expectedUpdatedAt":null}`)
	var document struct {
		Preference struct {
			RedirectMode string `json:"redirectMode"`
			UpdatedAt    string `json:"updatedAt"`
		} `json:"preference"`
	}
	require.NoError(t, json.Unmarshal(saved, &document))
	require.Equal(t, "confirmation", document.Preference.RedirectMode)
	version, err := time.Parse(time.RFC3339Nano, document.Preference.UpdatedAt)
	require.NoError(t, err)
	require.False(t, version.IsZero())
	require.JSONEq(t, `{"preference":{"redirectMode":"confirmation","updatedAt":"`+document.Preference.UpdatedAt+`"}}`, string(saved))
	require.JSONEq(t, string(saved), string(domainOrderRequest(t, application, admin, http.MethodGet, path, "")))
	require.JSONEq(t, `{"preference":{"redirectMode":null,"updatedAt":null}}`, string(domainOrderRequest(t, application, other, http.MethodGet, path, "")))
	require.NoError(t, application.pool.QueryRow(t.Context(), snapshot).Scan(&after))
	require.Equal(t, before, after)
}

// A stale tab must not read or write another account after its shared Cookie changes.
// The expected identity is a precondition only; it never selects a resource owner.
func TestRedirectPreferenceSharedCookieIdentity(t *testing.T) {
	application := newTestApplication(t)
	admin := domainOrderLogin(t, application)
	var adminID string
	require.NoError(t, application.pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&adminID))
	const otherID = "00000000-0000-0000-0000-000000000392"
	_, err := application.pool.Exec(t.Context(), `insert into app_user(id,username,password_hash,nickname,group_id,status,builtin,created_at,updated_at)
		select $1,'redirect-other-tab',password_hash,'Other tab',group_id,'active',false,now(),now() from app_user where username='admin'`, otherID)
	require.NoError(t, err)
	session, err := auth.NewSessionService(application.pool, time.Hour).Create(t.Context(), otherID)
	require.NoError(t, err)
	other := &http.Cookie{Name: auth.SessionCookieName, Value: session.ID}
	const path = "/api/v1/user/redirect-preference"
	request := func(cookie *http.Cookie, expected []string, method string, want int) json.RawMessage {
		t.Helper()
		target, body := path, ""
		if method == http.MethodPost {
			target += "/update"
			body = `{"redirectMode":"confirmation","expectedUpdatedAt":null}`
		}
		r := httptest.NewRequestWithContext(t.Context(), method, target, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		for _, value := range expected {
			r.Header.Add("X-MoeURL-Expected-User-ID", value)
		}
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var envelope struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope))
		require.Equal(t, want, envelope.Code, w.Body.String())
		if want != 0 {
			require.JSONEq(t, `null`, string(envelope.Data))
		}
		return envelope.Data
	}
	request(admin, []string{adminID}, http.MethodGet, 0)
	for _, expected := range [][]string{{adminID}, {""}, {otherID, adminID}} {
		request(other, expected, http.MethodPost, 120001)
		request(other, expected, http.MethodGet, 120001)
	}
	var count int
	require.NoError(t, application.pool.QueryRow(t.Context(), `select count(*) from user_redirect_preference`).Scan(&count))
	require.Zero(t, count)
	// Matching Cookie identity succeeds, and the old body-only API still means current self.
	request(other, []string{otherID}, http.MethodPost, 0)
	data := request(other, nil, http.MethodGet, 0)
	require.Contains(t, string(data), `"redirectMode":"confirmation"`)
	require.NoError(t, application.pool.QueryRow(t.Context(), `select count(*) from user_redirect_preference where user_id=$1`, adminID).Scan(&count))
	require.Zero(t, count)
}
