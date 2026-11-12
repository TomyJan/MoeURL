package targetpolicy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/stretchr/testify/require"
)

// Only external storage I/O is replaced; assertions inspect real HTTP output.
type allowlistPortResult struct{ err error }

func (p allowlistPortResult) Get(context.Context, auth.CurrentUser) (AllowlistSettings, error) {
	return AllowlistSettings{Enabled: true, Hosts: []string{"saved.example"}, UpdatedAt: "2026-11-12T00:00:00Z"}, p.err
}
func (p allowlistPortResult) Update(_ context.Context, _ auth.CurrentUser, input AllowlistUpdateInput) (AllowlistSettings, error) {
	return AllowlistSettings{Enabled: input.Enabled, Hosts: input.Hosts, UpdatedAt: input.ExpectedUpdatedAt}, p.err
}

// TestAllowlistHandlerFramingAndErrors catches protocol ambiguity, wrong public
// codes, caching private policy and leaking raw database/host errors.
func TestAllowlistHandlerFramingAndErrors(t *testing.T) {
	valid := `{"enabled":true,"hosts":["typed.example"],"expectedUpdatedAt":"2026-11-12T00:00:00Z"}`
	for _, tc := range []struct {
		name, method, url, media, body string
		err                            error
		status, code                   int
	}{
		{"get", "GET", "/policy", "", "", nil, 200, 0},
		{"query", "GET", "/policy?x=1", "", "", nil, 200, 900212},
		{"empty query", "GET", "/policy?", "", "", nil, 200, 900212},
		{"save", "POST", "/policy", "application/json; charset=utf-8", valid, nil, 200, 0},
		{"form", "POST", "/policy", "text/plain", valid, nil, 200, 900212},
		{"bad media", "POST", "/policy", "application/json; charset", valid, nil, 200, 900212},
		{"save query", "POST", "/policy?x=1", "application/json", valid, nil, 200, 900212},
		{"save empty query", "POST", "/policy?", "application/json", valid, nil, 200, 900212},
		{"bad body", "POST", "/policy", "application/json", "null", nil, 200, 900212},
		{"denied", "GET", "/policy", "", "", ErrPermissionDenied, 200, 120001},
		{"invalid", "POST", "/policy", "application/json", valid, ErrInvalidInput, 200, 900212},
		{"conflict", "POST", "/policy", "application/json", valid, ErrConflict, 200, 900213},
		{"get infra", "GET", "/policy", "", "", errors.New("private.example database detail"), 500, 900000},
		{"save infra", "POST", "/policy", "application/json", valid, errors.New("private.example database detail"), 500, 900000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var log bytes.Buffer
			h := NewAllowlistHandler(allowlistPortResult{tc.err}, slog.New(slog.NewTextHandler(&log, nil)))
			r := httptest.NewRequest(tc.method, tc.url, strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.media)
			w := httptest.NewRecorder()
			if tc.method == "GET" {
				h.Get(w, r)
			} else {
				h.Update(w, r)
			}
			require.Equal(t, tc.status, w.Code)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			var body struct {
				Code int
				Data *AllowlistSettings
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			require.Equal(t, tc.code, body.Code)
			if tc.code == 0 {
				require.NotNil(t, body.Data)
				require.True(t, body.Data.Enabled)
				if tc.method == "POST" {
					require.Equal(t, []string{"typed.example"}, body.Data.Hosts)
				}
			} else {
				require.Nil(t, body.Data)
			}
			require.NotContains(t, w.Body.String(), "private.example")
			require.NotContains(t, log.String(), "private.example")
		})
	}
	w := httptest.NewRecorder()
	NewAllowlistHandler(allowlistPortResult{}, nil).Get(w, httptest.NewRequest("GET", "/policy", nil))
	require.Equal(t, 200, w.Code)
}
