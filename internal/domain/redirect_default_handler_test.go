package domain_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/stretchr/testify/require"
)

// redirectDefaultHTTP keeps the real decoder and identity middleware at the HTTP boundary.
func redirectDefaultHTTP(t *testing.T, h *domain.RedirectDefaultHandler, actor auth.CurrentUser, action, query, body, media string) *httptest.ResponseRecorder {
	t.Helper()
	method := http.MethodGet
	handler := h.Get
	if action == "set" {
		method = http.MethodPost
		handler = h.Set
	}
	if action == "available" {
		handler = h.Available
	}
	r := httptest.NewRequestWithContext(t.Context(), method, "/api/v1/domain/redirect-default"+query, strings.NewReader(body))
	if media != "" {
		r.Header.Set("Content-Type", media)
	}
	r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "isolated-test-session"})
	w := httptest.NewRecorder()
	auth.CurrentUserMiddleware(domainUserResolver{actor: actor})(http.HandlerFunc(handler)).ServeHTTP(w, r)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	return w
}

// TestDomainRedirectDefaultHTTPContract catches accepted ambiguous commands,
// missing no-store and HTTP success that hides a failed or unauthorized save.
func TestDomainRedirectDefaultHTTPContract(t *testing.T) {
	s, pool, admin, user, d := orderFixture(t)
	h := domain.NewRedirectDefaultHandler(s, nil)
	valid := fmt.Sprintf(`{"id":%q,"redirectMode":"confirmation","expectedUpdatedAt":%q}`, d.ID, d.UpdatedAt)
	check := func(action, query, body, media string, actor auth.CurrentUser, want int) []byte {
		t.Helper()
		w := redirectDefaultHTTP(t, h, actor, action, query, body, media)
		require.Equal(t, http.StatusOK, w.Code)
		var result struct{ Code int }
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Equal(t, want, result.Code, w.Body.String())
		return w.Body.Bytes()
	}
	for _, query := range []string{"", "?id=", "?id=broken", "?id=%zz", "?id=" + d.ID + "&id=" + d.ID, "?id=" + d.ID + "&extra=1"} {
		check("get", query, "", "", admin, 100001)
	}
	check("get", "?id="+d.ID, "", "", user, 120001)
	check("get", "?id="+d.ID, "", "", auth.CurrentUser{}, 120001)
	check("available", "?groupKey=admin", "", "", admin, 100001)
	check("available", "", "", "", auth.CurrentUser{}, 120001)
	for _, body := range []string{"", "null", "[]", "{", `{}`, `{"id":"x",1:1}`, `{"id":"x"`,
		strings.TrimSuffix(valid, "}") + `,"extra":1}`, strings.TrimSuffix(valid, "}") + `,"id":"x"}`,
		strings.Replace(valid, `"confirmation"`, "null", 1), strings.Replace(valid, `"confirmation"`, "true", 1), valid + " {}", valid + " junk"} {
		check("set", "", body, "application/json", admin, 100001)
	}
	check("set", "", valid, "text/plain", admin, 100001)
	check("set", "", valid, "application/json", user, 120001)
	var mode string
	require.NoError(t, pool.QueryRow(t.Context(), `select default_redirect_mode from domain where id=$1`, d.ID).Scan(&mode))
	require.Equal(t, "direct", mode, "rejected requests must not mutate persistence")
	raw := check("set", "", valid, "application/json; charset=utf-8", admin, 0)
	var saved struct {
		Data struct{ Setting domain.RedirectDefaultSetting }
	}
	require.NoError(t, json.Unmarshal(raw, &saved))
	require.Equal(t, "confirmation", saved.Data.Setting.RedirectMode)
	require.NotEqual(t, d.UpdatedAt, saved.Data.Setting.UpdatedAt)
	check("set", "", valid, "application/json", admin, 210103)
	var read struct {
		Data struct{ Setting domain.RedirectDefaultSetting }
	}
	require.NoError(t, json.Unmarshal(check("get", "?id="+d.ID, "", "", admin, 0), &read))
	require.Equal(t, saved.Data.Setting, read.Data.Setting)
	_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions || '["short_link:create","short_link:use_confirmation"]'::jsonb where key='admin'`)
	require.NoError(t, err)
	var available struct {
		Data struct {
			Items []domain.EffectiveRedirectDefault
		}
	}
	require.NoError(t, json.Unmarshal(check("available", "", "", "", admin, 0), &available))
	require.Contains(t, available.Data.Items, domain.EffectiveRedirectDefault{DomainID: d.ID, RedirectMode: "confirmation"})
}

type redirectDefaultFailurePort struct{ failure error }

// GetRedirectDefault injects an external storage failure, not a fake HTTP response.
func (p redirectDefaultFailurePort) GetRedirectDefault(context.Context, auth.CurrentUser, string) (domain.RedirectDefaultSetting, error) {
	return domain.RedirectDefaultSetting{}, p.failure
}

// SetRedirectDefault uses the same boundary to test write-error sanitization.
func (p redirectDefaultFailurePort) SetRedirectDefault(context.Context, auth.CurrentUser, domain.SetRedirectDefaultInput) (domain.RedirectDefaultSetting, error) {
	return domain.RedirectDefaultSetting{}, p.failure
}

// RedirectDefaults lets a failed read be observed without inventing successful empty data.
func (p redirectDefaultFailurePort) RedirectDefaults(context.Context, auth.CurrentUser) ([]domain.EffectiveRedirectDefault, error) {
	return nil, p.failure
}

// TestDomainRedirectDefaultHTTPSanitizesInfrastructure catches secrets in either
// HTTP diagnostics or logs and infrastructure errors downgraded to business success.
func TestDomainRedirectDefaultHTTPSanitizesInfrastructure(t *testing.T) {
	for _, action := range []string{"get", "set", "available"} {
		var logs bytes.Buffer
		h := domain.NewRedirectDefaultHandler(redirectDefaultFailurePort{errors.New("postgres://secret@private-db")}, slog.New(slog.NewJSONHandler(&logs, nil)))
		query := "?id=00000000-0000-0000-0000-000000000729"
		if action == "available" {
			query = ""
		}
		w := redirectDefaultHTTP(t, h, auth.CurrentUser{}, action, query, `{"id":"00000000-0000-0000-0000-000000000729","redirectMode":"direct","expectedUpdatedAt":"2026-10-28T00:00:00Z"}`, "application/json")
		require.Equal(t, http.StatusInternalServerError, w.Code)
		var body struct{ Code int }
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Equal(t, 900000, body.Code)
		require.NotContains(t, w.Body.String()+logs.String(), "postgres://secret")
	}
}
