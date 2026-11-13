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

// Only external persistence is replaced; assertions inspect actual HTTP output.
type ipPortResult struct{ err error }

func (p ipPortResult) Get(context.Context, auth.CurrentUser) (IPSettings, error) {
	return IPSettings{Addresses: []string{"192.0.2.1"}, UpdatedAt: "2026-11-13T00:00:00Z"}, p.err
}
func (p ipPortResult) Update(_ context.Context, _ auth.CurrentUser, input IPUpdateInput) (IPSettings, error) {
	return IPSettings{Addresses: input.Addresses, UpdatedAt: input.ExpectedUpdatedAt}, p.err
}

// TestIPHandlerFramingAndErrors catches wrong public codes, private caching,
// ambiguous HTTP framing and disclosure of value-bearing database errors.
func TestIPHandlerFramingAndErrors(t *testing.T) {
	valid := `{"addresses":["203.0.113.9"],"expectedUpdatedAt":"2026-11-13T00:00:00Z"}`
	for _, tc := range []struct {
		name, method, url, media, body string
		err                            error
		status, code                   int
	}{
		{"get", "GET", "/policy", "", "", nil, 200, 0},
		{"query", "GET", "/policy?x=1", "", "", nil, 200, 900220},
		{"empty query", "GET", "/policy?", "", "", nil, 200, 900220},
		{"save", "POST", "/policy", "application/json; charset=utf-8", valid, nil, 200, 0},
		{"form", "POST", "/policy", "text/plain", valid, nil, 200, 900220},
		{"bad media", "POST", "/policy", "application/json; charset", valid, nil, 200, 900220},
		{"save query", "POST", "/policy?x=1", "application/json", valid, nil, 200, 900220},
		{"save empty query", "POST", "/policy?", "application/json", valid, nil, 200, 900220},
		{"bad body", "POST", "/policy", "application/json", "null", nil, 200, 900220},
		{"denied", "GET", "/policy", "", "", ErrPermissionDenied, 200, 120001},
		{"invalid", "POST", "/policy", "application/json", valid, ErrInvalidInput, 200, 900220},
		{"conflict", "POST", "/policy", "application/json", valid, ErrConflict, 200, 900221},
		{"get infra", "GET", "/policy", "", "", errors.New("203.0.113.17 database detail"), 500, 900000},
		{"save infra", "POST", "/policy", "application/json", valid, errors.New("203.0.113.17 database detail"), 500, 900000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var log bytes.Buffer
			h := NewIPHandler(ipPortResult{tc.err}, slog.New(slog.NewTextHandler(&log, nil)))
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
				Data *IPSettings
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			require.Equal(t, tc.code, body.Code)
			if tc.code == 0 {
				require.NotNil(t, body.Data)
				if tc.method == "POST" {
					require.Equal(t, []string{"203.0.113.9"}, body.Data.Addresses)
				} else {
					require.Equal(t, []string{"192.0.2.1"}, body.Data.Addresses)
				}
			} else {
				require.Nil(t, body.Data)
			}
			require.NotContains(t, w.Body.String(), "203.0.113.17")
			require.NotContains(t, log.String(), "203.0.113.17")
		})
	}
	w := httptest.NewRecorder()
	NewIPHandler(ipPortResult{}, nil).Get(w, httptest.NewRequest("GET", "/policy", nil))
	require.Equal(t, 200, w.Code)
}
