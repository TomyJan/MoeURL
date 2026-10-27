package usergroup

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// Catches strict decoding and no-store requirements at the actual handler/database boundary.
func TestGroupDefaultHandlerDocuments(t *testing.T) {
	f := groupDefaultFixture(t)
	h := NewDomainDefaultHandler(f.s, nil)
	input := f.input(t, "user", &f.assigned)
	valid := fmt.Sprintf(`{"groupKey":"user","domainId":%q,"expectedUpdatedAt":%q}`, f.assigned, input.ExpectedUpdatedAt)
	for _, scenario := range []struct {
		name, path, body, media string
		handler                 http.HandlerFunc
		want                    int
	}{
		{"management", "/?groupKey=user", "", "", h.Get, 0},
		{"unknown group", "/?groupKey=team", "", "", h.Get, 100001},
		{"duplicate group", "/?groupKey=user&groupKey=admin", "", "", h.Get, 100001},
		{"unknown query", "/?groupKey=user&extra=1", "", "", h.Get, 100001},
		{"broken query", "/?groupKey=%zz", "", "", h.Get, 100001},
		{"self", "/", "", "", h.GetCurrent, 0},
		{"self selector", "/?userId=1", "", "", h.GetCurrent, 100001},
		{"missing media", "/", valid, "", h.Set, 100001},
		{"wrong media", "/", valid, "text/plain", h.Set, 100001},
		{"broken JSON", "/", "{", "application/json", h.Set, 100001},
		{"null", "/", "null", "application/json", h.Set, 100001},
		{"missing domain", "/", `{"groupKey":"user","expectedUpdatedAt":"2026-10-27T00:00:00Z"}`, "application/json", h.Set, 100001},
		{"null revision", "/", `{"groupKey":"user","domainId":null,"expectedUpdatedAt":null}`, "application/json", h.Set, 100001},
		{"unknown field", "/", strings.TrimSuffix(valid, "}") + `,"extra":true}`, "application/json", h.Set, 100001},
		{"trailing value", "/", valid + ` {}`, "application/json", h.Set, 100001},
		{"boolean domain", "/", fmt.Sprintf(`{"groupKey":"user","domainId":true,"expectedUpdatedAt":%q}`, input.ExpectedUpdatedAt), "application/json", h.Set, 100001},
		{"valid save", "/", valid, "application/json;charset=utf-8", h.Set, 0},
		{"stale save", "/", valid, "application/json", h.Set, 300202},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			method := "GET"
			if scenario.media != "" || scenario.body != "" {
				method = "POST"
			}
			r := httptest.NewRequestWithContext(t.Context(), method, scenario.path, strings.NewReader(scenario.body))
			if scenario.media != "" {
				r.Header.Set("Content-Type", scenario.media)
			}
			w := serveUserGroupHandler(t, scenario.handler, f.actor, r)
			require.Equal(t, http.StatusOK, w.Code)
			require.Equal(t, scenario.want, decodeHandlerEnvelope(t, w).Code)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		})
	}
	clear := fmt.Sprintf(`{"groupKey":"user","domainId":null,"expectedUpdatedAt":%q}`, f.input(t, "user", nil).ExpectedUpdatedAt)
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(clear))
	r.Header.Set("Content-Type", "application/json")
	w := serveUserGroupHandler(t, http.HandlerFunc(h.Set), f.actor, r)
	require.Zero(t, decodeHandlerEnvelope(t, w).Code)
}
