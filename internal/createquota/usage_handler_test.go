package createquota

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/stretchr/testify/require"
)

type usageProtocolService struct{ err error }

func (s usageProtocolService) GetOwnUsage(context.Context, auth.CurrentUser) (Usage, error) {
	return Usage{UsageDay: "2026-11-12", Used: "9223372036854775807"}, s.err
}

type usageProtocolIdentity struct{ id string }

func (u usageProtocolIdentity) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	return auth.CurrentUser{ID: u.id}, nil
}

// TestOwnUsageProtocol exercises real framing/ownership checks and confirms
// neither the envelope nor logger leaks an external infrastructure error.
func TestOwnUsageProtocol(t *testing.T) {
	const actor = "55ac4abf-b6fe-4e7d-ae50-aa2965fe276e"
	for _, tc := range []struct {
		name, path, id string
		header         []string
		err            error
		status, code   int
	}{
		{"self without header", "/usage", actor, nil, nil, 200, 0},
		{"matching header", "/usage", actor, []string{actor}, nil, 200, 0},
		{"guest", "/usage", "", nil, nil, 200, 120001},
		{"query", "/usage?actor=other", actor, nil, nil, 200, 100001},
		{"bare query", "/usage?", actor, nil, nil, 200, 100001},
		{"empty header", "/usage", actor, []string{""}, nil, 200, 120001},
		{"empty header list", "/usage", actor, []string{}, nil, 200, 120001},
		{"duplicate header", "/usage", actor, []string{actor, actor}, nil, 200, 120001},
		{"other owner", "/usage", actor, []string{"eeac4abf-b6fe-4e7d-ae50-aa2965fe276e"}, nil, 200, 120001},
		{"invalid owner", "/usage", "bad", nil, nil, 200, 120001},
		{"revoked", "/usage", actor, nil, ErrPermissionDenied, 200, 120001},
		{"invalid input", "/usage", actor, nil, ErrInvalidInput, 200, 100001},
		{"infrastructure", "/usage", actor, nil, errors.New("secret_usage_9223372036854775807"), 500, 900000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var log bytes.Buffer
			h := NewUsageHandler(usageProtocolService{tc.err}, slog.New(slog.NewTextHandler(&log, nil)))
			r := httptest.NewRequestWithContext(t.Context(), "GET", tc.path, nil)
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "test-session"})
			if tc.header != nil {
				r.Header[http.CanonicalHeaderKey("X-MoeURL-Expected-User-ID")] = tc.header
			}
			w := httptest.NewRecorder()
			auth.CurrentUserMiddleware(usageProtocolIdentity{tc.id})(http.HandlerFunc(h.Get)).ServeHTTP(w, r)
			require.Equal(t, tc.status, w.Code)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			var value struct {
				Code int
				Data map[string]any
				Meta map[string]any
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &value))
			require.Equal(t, tc.code, value.Code)
			require.NotNil(t, value.Meta)
			if tc.code == 0 {
				require.Len(t, value.Data, 4)
				require.Equal(t, "9223372036854775807", value.Data["used"])
			} else {
				require.Nil(t, value.Data)
			}
			require.NotContains(t, w.Body.String(), "secret_usage")
			require.NotContains(t, log.String(), "9223372036854775807")
			require.NotContains(t, log.String(), actor)
		})
	}
	// The default logger path must retain the same opaque successful protocol.
	w := httptest.NewRecorder()
	r := httptest.NewRequestWithContext(t.Context(), "GET", "/usage", nil)
	r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "s"})
	h := NewUsageHandler(usageProtocolService{}, nil)
	auth.CurrentUserMiddleware(usageProtocolIdentity{actor})(http.HandlerFunc(h.Get)).ServeHTTP(w, r)
	require.Equal(t, 200, w.Code)
}
