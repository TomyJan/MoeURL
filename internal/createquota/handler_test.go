package createquota

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

// quotaPortResult replaces only external service I/O; assertions inspect the
// real protocol response and sanitized diagnostics rather than mock calls.
type quotaPortResult struct{ err error }

func (p quotaPortResult) Get(context.Context, auth.CurrentUser) (Settings, error) {
	limit := int64(12)
	return Settings{DailyLimit: &limit, UpdatedAt: "2026-11-12T00:00:00.123456Z"}, p.err
}
func (p quotaPortResult) Update(_ context.Context, _ auth.CurrentUser, input UpdateInput) (Settings, error) {
	return Settings{DailyLimit: input.DailyLimit, UpdatedAt: input.ExpectedUpdatedAt}, p.err
}

// TestDailyCreateQuotaHandler catches query ambiguity, incorrect framing,
// coercion and exposing private infrastructure error text or policy data.
func TestDailyCreateQuotaHandler(t *testing.T) {
	valid := `{"dailyLimit":7,"expectedUpdatedAt":"2026-11-12T00:00:00.123456Z"}`
	for _, tc := range []struct {
		name, method, url, media, body string
		err                            error
		status, code                   int
	}{
		{"get", "GET", "/quota", "", "", nil, 200, 0}, {"save", "POST", "/quota", "application/json", valid, nil, 200, 0},
		{"get query", "GET", "/quota?x=1", "", "", nil, 200, 900214}, {"get empty query", "GET", "/quota?", "", "", nil, 200, 900214},
		{"save query", "POST", "/quota?x=1", "application/json", valid, nil, 200, 900214}, {"save empty query", "POST", "/quota?", "application/json", valid, nil, 200, 900214},
		{"media", "POST", "/quota", "text/plain", valid, nil, 200, 900214}, {"malformed media", "POST", "/quota", "application/json; charset", valid, nil, 200, 900214},
		{"bad body", "POST", "/quota", "application/json", "null", nil, 200, 900214},
		{"denied", "GET", "/quota", "", "", ErrPermissionDenied, 200, 120001}, {"invalid", "POST", "/quota", "application/json", valid, ErrInvalidInput, 200, 900214},
		{"conflict", "POST", "/quota", "application/json", valid, ErrConflict, 200, 900215},
		{"get infra", "GET", "/quota", "", "", errors.New("private database detail"), 500, 900000}, {"save infra", "POST", "/quota", "application/json", valid, errors.New("private database detail"), 500, 900000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var log bytes.Buffer
			h := NewHandler(quotaPortResult{tc.err}, slog.New(slog.NewTextHandler(&log, nil)))
			r := httptest.NewRequestWithContext(t.Context(), tc.method, tc.url, strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.media)
			w := httptest.NewRecorder()
			if tc.method == "GET" {
				h.Get(w, r)
			} else {
				h.Update(w, r)
			}
			require.Equal(t, tc.status, w.Code)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			var response struct {
				Code int
				Data *Settings
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
			require.Equal(t, tc.code, response.Code)
			if tc.code == 0 {
				require.NotNil(t, response.Data)
				require.NotNil(t, response.Data.DailyLimit)
				if tc.method == "POST" {
					require.Equal(t, int64(7), *response.Data.DailyLimit)
				} else {
					require.Equal(t, int64(12), *response.Data.DailyLimit)
				}
			} else {
				require.Nil(t, response.Data)
			}
			require.NotContains(t, w.Body.String(), "private database detail")
			require.NotContains(t, log.String(), "private database detail")
		})
	}
	w := httptest.NewRecorder()
	NewHandler(quotaPortResult{}, nil).Get(w, httptest.NewRequestWithContext(t.Context(), "GET", "/quota", nil))
	require.Equal(t, 200, w.Code)
}
