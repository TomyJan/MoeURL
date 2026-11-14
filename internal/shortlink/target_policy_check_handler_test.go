package shortlink_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// The transport contract is exercised in this package as well as through App:
// malformed requests must never become decisions, and saved rules and current
// database grants must control the actual JSON response.
func TestTargetPolicyCheckHandlerProtocol(t *testing.T) {
	pool, service, actor := targetWriteFixture(t)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), actor.ID)
	require.NoError(t, err)
	handler := auth.CurrentUserMiddleware(auth.NewService(pool, time.Hour))(http.HandlerFunc(shortlink.NewTargetPolicyCheckHandler(service, nil).Check))
	const valid = `{"targetUrl":"https://private.example/path?secret=fixture"}`
	call := func(t *testing.T, url, media, body string, code int, outcome string) {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), "POST", url, strings.NewReader(body))
		r.Header.Set("Content-Type", media)
		r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session.ID})
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var response struct {
			Code int
			Data map[string]string
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, code, response.Code, w.Body.String())
		if code == 0 {
			require.Equal(t, map[string]string{"outcome": outcome}, response.Data)
		} else {
			require.Nil(t, response.Data)
		}
		require.NotContains(t, w.Body.String(), "private.example")
		require.NotContains(t, w.Body.String(), "secret")
	}
	for i, body := range []string{"", `[]`, `null`, `{}`, `{"TargetUrl":"https://example.com/"}`, `{"targetUrl":null}`, `{"targetUrl":3}`, `{"targetUrl":""}`, `{"targetUrl":"https://example.com/","target\u0055rl":"https://example.com/"}`, `{"targetUrl":"https://example.com/"`, valid + `{}`, valid + `x`, strings.Repeat(" ", 16385), "{\"targetUrl\":\"https://example.com/\xff\"}"} {
		t.Run(fmt.Sprintf("malformed %d", i), func(t *testing.T) { call(t, "/", "application/json", body, 900226, "") })
	}
	for _, media := range []string{"", "text/plain", "application/json;broken"} {
		call(t, "/", media, valid, 900226, "")
	}
	call(t, "/?", "application/json", valid, 900226, "")
	call(t, "/?x=1", "application/json", valid, 900226, "")
	call(t, "/", "application/json", valid, 0, "allowed")
	_, err = pool.Exec(t.Context(), `update system_setting set value='{"hosts":["private.example"]}' where key='security.target_host_denylist'`)
	require.NoError(t, err)
	call(t, "/", "application/json", valid, 0, "restricted")
	call(t, "/", "application/json", `{"targetUrl":"https://localhost/"}`, 0, "invalid_target")
	_, err = pool.Exec(t.Context(), `update user_group set permissions='["admin:access"]' where key='admin'`)
	require.NoError(t, err)
	call(t, "/", "application/json", valid, 120001, "")
}

type failedPolicyBody struct{}

// JSON must not silently replace malformed surrogate escapes before checking
// an administrator's original target. Valid Unicode and exact byte limits stay usable.
func TestTargetPolicyCheckUnicodePreservation(t *testing.T) {
	pool, service, actor := targetWriteFixture(t)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), actor.ID)
	require.NoError(t, err)
	handler := auth.CurrentUserMiddleware(auth.NewService(pool, time.Hour))(http.HandlerFunc(shortlink.NewTargetPolicyCheckHandler(service, nil).Check))
	before := policyCheckDatabaseSnapshot(t, pool)
	// Authentication updates last_seen_at; the check must not change business tables.
	delete(before, "session")
	for _, tc := range []struct {
		name, body, outcome string
		code                int
	}{
		{"isolated high", `{"targetUrl":"https://example.com/\ud800"}`, "", 900226},
		{"isolated low", `{"targetUrl":"https://example.com/\udfff"}`, "", 900226},
		{"reversed pair", `{"targetUrl":"https://example.com/\udc00\ud800"}`, "", 900226},
		{"interrupted pair", `{"targetUrl":"https://example.com/\ud800x\udc00"}`, "", 900226},
		{"high followed by high", `{"targetUrl":"https://example.com/\ud800\ud801"}`, "", 900226},
		{"high followed by non surrogate", `{"targetUrl":"https://example.com/\ud800\u0061"}`, "", 900226},
		{"valid pair", `{"targetUrl":"https://example.com/\ud83d\ude00"}`, "allowed", 0},
		{"literal non BMP", `{"targetUrl":"https://example.com/😀"}`, "allowed", 0},
		{"literal replacement character", `{"targetUrl":"https://example.com/�"}`, "allowed", 0},
		{"escaped replacement character", `{"targetUrl":"https://example.com/\ufffd"}`, "allowed", 0},
		{"escaped backslash", `{"targetUrl":"https://example.com/\\ud800"}`, "allowed", 0},
		{"non BMP at byte limit", `{"targetUrl":"https://example.com/` + strings.Repeat(`\ud83d\ude00`, 507) + `"}`, "allowed", 0},
		{"non BMP over byte limit", `{"targetUrl":"https://example.com/` + strings.Repeat(`\ud83d\ude00`, 508) + `"}`, "", 900226},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", "application/json")
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session.ID})
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			require.Equal(t, 200, w.Code)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			var response struct {
				Code int
				Data map[string]string
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
			require.Equal(t, tc.code, response.Code, w.Body.String())
			if tc.code == 0 {
				require.Equal(t, map[string]string{"outcome": tc.outcome}, response.Data)
			} else {
				require.Nil(t, response.Data)
			}
			require.NotContains(t, w.Body.String(), "example.com")
		})
	}
	after := policyCheckDatabaseSnapshot(t, pool)
	delete(after, "session")
	require.Equal(t, before, after)
}

func (failedPolicyBody) Read([]byte) (int, error) { return 0, errors.New("private body read failure") }

// Truncated transport reads cannot be interpreted as an empty allowed target.
func TestTargetPolicyCheckBodyReadFailure(t *testing.T) {
	handler := shortlink.NewTargetPolicyCheckHandler(nil, nil)
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/", nil)
	r.Header.Set("Content-Type", "application/json")
	r.Body = io.NopCloser(failedPolicyBody{})
	w := httptest.NewRecorder()
	handler.Check(w, r)
	require.Equal(t, 200, w.Code)
	require.Contains(t, w.Body.String(), `"code":900226`)
	require.Contains(t, w.Body.String(), `"data":null`)
	require.NotContains(t, w.Body.String(), "private")
}

// An infrastructure outage must return a fixed error without exposing the
// input URL, storage internals or an optimistic decision in either channel.
func TestTargetPolicyCheckInfrastructurePrivacy(t *testing.T) {
	pool, service, _ := targetWriteFixture(t)
	pool.Close()
	var logs bytes.Buffer
	handler := shortlink.NewTargetPolicyCheckHandler(service, slog.New(slog.NewJSONHandler(&logs, nil)))
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(`{"targetUrl":"https://private.example/path?secret=fixture"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.Check(w, r)
	require.Equal(t, 500, w.Code)
	require.Contains(t, w.Body.String(), `"code":900000`)
	require.Contains(t, w.Body.String(), `"data":null`)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	require.Contains(t, logs.String(), "target_policy_check_failed")
	for _, value := range []string{"private.example", "secret", "closed pool", "allowed"} {
		require.NotContains(t, logs.String()+w.Body.String(), value)
	}
}
