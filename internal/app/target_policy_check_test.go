package app

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// Missing production wiring must fail a real authorized request, rather than
// passing through a mock that never exercises the deployed API.
func TestTargetPolicyCheckHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	result := homeContentCall(t, a, cookie, "POST", "/api/v1/admin/system/target-policy/check", `{"targetUrl":"https://example.com/private?secret=not-returned"}`, 200, 0)
	require.Equal(t, map[string]any{"outcome": "allowed"}, result)
}

// Ambiguous JSON and oversized or controlled values must never reach a
// permissive check; byte boundaries are independent of character count.
func TestTargetPolicyCheckProtocol(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	const path = "/api/v1/admin/system/target-policy/check"
	for _, tc := range []struct{ name, body string }{
		{"empty", ""}, {"array", `[]`}, {"null", `null`}, {"missing", `{}`},
		{"wrong key case", `{"TargetUrl":"https://example.com/"}`},
		{"unknown", `{"targetUrl":"https://example.com/","other":1}`},
		{"duplicate", `{"targetUrl":"https://example.com/","targetUrl":"https://other.example/"}`},
		{"escaped duplicate", `{"targetUrl":"https://example.com/","target\u0055rl":"https://other.example/"}`},
		{"number", `{"targetUrl":3}`}, {"null field", `{"targetUrl":null}`},
		{"nested", `{"targetUrl":{"value":"https://example.com/"}}`},
		{"empty field", `{"targetUrl":""}`}, {"unfinished", `{"targetUrl":"https://example.com/"`},
		{"bad token", `{"targetUrl":"https://example.com/",}`},
		{"trailing object", `{"targetUrl":"https://example.com/"}{}`},
		{"trailing garbage", `{"targetUrl":"https://example.com/"}x`},
		{"null control", `{"targetUrl":"https://example.com/\u0000"}`},
		{"unicode control", `{"targetUrl":"https://example.com/\u0085"}`},
		{"bad UTF8", "{\"targetUrl\":\"https://example.com/\xff\"}"},
		{"body limit", strings.Repeat(" ", 16385)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			homeContentCall(t, a, cookie, "POST", path, tc.body, 200, 900226)
		})
	}
	for _, tc := range []struct {
		name, value string
		code        int
	}{
		{"ASCII 2048", "https://example.com/" + strings.Repeat("a", 2028), 0},
		{"ASCII 2049", "https://example.com/" + strings.Repeat("a", 2029), 900226},
		{"UTF8 2048", "https://example.com/" + strings.Repeat("界", 676), 0},
		{"UTF8 2049", "https://example.com/" + strings.Repeat("界", 676) + "a", 900226},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if strings.Contains(tc.name, "2048") {
				require.Len(t, []byte(tc.value), 2048)
			} else {
				require.Len(t, []byte(tc.value), 2049)
			}
			body, err := json.Marshal(map[string]string{"targetUrl": tc.value})
			require.NoError(t, err)
			homeContentCall(t, a, cookie, "POST", path, string(body), 200, tc.code)
		})
	}
	for _, media := range []string{"", "text/plain", "application/x-www-form-urlencoded", "application/json;broken"} {
		r := httptest.NewRequestWithContext(t.Context(), "POST", path, strings.NewReader(`{"targetUrl":"https://example.com/"}`))
		r.AddCookie(cookie)
		r.Header.Set("Content-Type", media)
		w := httptest.NewRecorder()
		a.server.Handler.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code)
		require.Contains(t, w.Body.String(), `"code":900226`)
	}
	for _, suffix := range []string{"?", "?targetUrl=private"} {
		homeContentCall(t, a, cookie, "POST", path+suffix, `{"targetUrl":"https://example.com/"}`, 200, 900226)
	}
	for _, tc := range []struct{ target, outcome string }{
		{"localhost", "invalid_target"}, {"https://localhost/", "invalid_target"},
		{"ftp://example.com/", "invalid_target"}, {"https://127.0.0.1/", "invalid_target"},
		{"https://example.com/", "allowed"},
	} {
		t.Run(fmt.Sprintf("outcome %s", tc.target), func(t *testing.T) {
			body, err := json.Marshal(map[string]string{"targetUrl": tc.target})
			require.NoError(t, err)
			require.Equal(t, map[string]any{"outcome": tc.outcome}, homeContentCall(t, a, cookie, "POST", path, string(body), 200, 0))
		})
	}
}
