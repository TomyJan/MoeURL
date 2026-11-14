package app

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// A missing batch route, discarded item or URL echo breaks this real session
// request; neither a permissive port fake nor a decoder-only test can pass it.
func TestTargetPolicyBatchCheckHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	result := homeContentCall(t, a, cookie, "POST", "/api/v1/admin/system/target-policy/check-batch", `{"targetUrls":["https://example.com/private?secret=not-returned","https://other.example/second"]}`, 200, 0)
	require.Equal(t, map[string]any{"items": []any{
		map[string]any{"index": float64(1), "outcome": "allowed"},
		map[string]any{"index": float64(2), "outcome": "allowed"},
	}}, result)
}

// Null elements, ambiguous framing and Unicode rewrites must reject the whole
// request, not silently drop an item or reinterpret its original URL.
func TestTargetPolicyBatchCheckProtocol(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	const path = "/api/v1/admin/system/target-policy/check-batch"
	const valid = `{"targetUrls":["https://example.com/"]}`
	for _, tc := range []struct{ name, body string }{
		{"empty", ""}, {"array", `[]`}, {"null", `null`}, {"missing", `{}`},
		{"wrong case", `{"TargetUrls":["https://example.com/"]}`},
		{"unknown", `{"targetUrls":["https://example.com/"],"other":1}`},
		{"duplicate", `{"targetUrls":["https://example.com/"],"targetUrls":["https://other.example/"]}`},
		{"escaped duplicate", `{"targetUrls":["https://example.com/"],"target\u0055rls":["https://other.example/"]}`},
		{"null array", `{"targetUrls":null}`}, {"null item", `{"targetUrls":[null]}`},
		{"number", `{"targetUrls":[3]}`}, {"scalar", `{"targetUrls":"https://example.com/"}`},
		{"object item", `{"targetUrls":[{}]}`}, {"nested", `{"targetUrls":[[]]}`},
		{"empty item", `{"targetUrls":[""]}`}, {"zero", `{"targetUrls":[]}`},
		{"unfinished", `{"targetUrls":["https://example.com/"]`},
		{"bad token", `{"targetUrls":["https://example.com/"],}`},
		{"trailing object", valid + `{}`}, {"trailing garbage", valid + `x`},
		{"control", `{"targetUrls":["https://example.com/\n"]}`},
		{"unicode control", `{"targetUrls":["https://example.com/\u0085"]}`},
		{"bad UTF8", "{\"targetUrls\":[\"https://example.com/\xff\"]}"},
		{"isolated high", `{"targetUrls":["https://example.com/\ud800"]}`},
		{"isolated low", `{"targetUrls":["https://example.com/\udfff"]}`},
		{"reversed pair", `{"targetUrls":["https://example.com/\udc00\ud800"]}`},
		{"interrupted pair", `{"targetUrls":["https://example.com/\ud800x\udc00"]}`},
		{"second item invalid Unicode", `{"targetUrls":["https://example.com/","https://example.com/\ud800"]}`},
		{"body limit", strings.Repeat(" ", 262145)},
	} {
		t.Run(tc.name, func(t *testing.T) { homeContentCall(t, a, cookie, "POST", path, tc.body, 200, 900227) })
	}
	for _, n := range []int{1, 20, 21} {
		t.Run(fmt.Sprintf("count %d", n), func(t *testing.T) {
			values := make([]string, n)
			for i := range values {
				values[i] = "https://example.com/repeated"
			}
			body, err := json.Marshal(map[string][]string{"targetUrls": values})
			require.NoError(t, err)
			code := 0
			if n == 21 {
				code = 900227
			}
			result := homeContentCall(t, a, cookie, "POST", path, string(body), 200, code)
			if code == 0 {
				items := result["items"].([]any)
				require.Len(t, items, n)
				for i, item := range items {
					require.Equal(t, map[string]any{"index": float64(i + 1), "outcome": "allowed"}, item)
				}
			}
		})
	}
	for _, tc := range []struct {
		name, target string
		code         int
	}{
		{"ASCII 2048", "https://example.com/" + strings.Repeat("a", 2028), 0},
		{"ASCII 2049", "https://example.com/" + strings.Repeat("a", 2029), 900227},
		{"UTF8 2048", "https://example.com/" + strings.Repeat("界", 676), 0},
		{"UTF8 2049", "https://example.com/" + strings.Repeat("界", 676) + "a", 900227},
		{"nonBMP 2048", "https://example.com/" + strings.Repeat("😀", 507), 0},
		{"nonBMP 2052", "https://example.com/" + strings.Repeat("😀", 508), 900227},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.code == 0 {
				require.Len(t, []byte(tc.target), 2048)
			}
			body, err := json.Marshal(map[string][]string{"targetUrls": {tc.target}})
			require.NoError(t, err)
			homeContentCall(t, a, cookie, "POST", path, string(body), 200, tc.code)
		})
	}
	for _, body := range []string{
		`{"targetUrls":["https://example.com/\ud83d\ude00"]}`,
		`{"targetUrls":["https://example.com/😀"]}`,
		`{"targetUrls":["https://example.com/�"]}`,
		`{"targetUrls":["https://example.com/\ufffd"]}`,
		`{"targetUrls":["https://example.com/\\ud800"]}`,
	} {
		require.Equal(t, map[string]any{"items": []any{map[string]any{"index": float64(1), "outcome": "allowed"}}}, homeContentCall(t, a, cookie, "POST", path, body, 200, 0))
	}
	// All characters of all twenty maximum-size targets may be JSON escaped.
	escaped := `"\u0068\u0074\u0074\u0070\u0073\u003a\u002f\u002f\u0065\u0078\u0061\u006d\u0070\u006c\u0065\u002e\u0063\u006f\u006d\u002f` + strings.Repeat(`\u0061`, 2028) + `"`
	body := `{"targetUrls":[` + strings.TrimSuffix(strings.Repeat(escaped+",", 20), ",") + `]}`
	require.Less(t, len(body), 262144)
	require.Len(t, homeContentCall(t, a, cookie, "POST", path, body, 200, 0)["items"].([]any), 20)
	// Exactly the transport limit remains accepted; one extra byte is rejected.
	homeContentCall(t, a, cookie, "POST", path, valid+strings.Repeat(" ", 262144-len(valid)), 200, 0)
	homeContentCall(t, a, cookie, "POST", path, valid+strings.Repeat(" ", 262145-len(valid)), 200, 900227)
	for _, media := range []string{"", "text/plain", "application/json;broken"} {
		r := httptest.NewRequestWithContext(t.Context(), "POST", path, strings.NewReader(valid))
		r.AddCookie(cookie)
		r.Header.Set("Content-Type", media)
		w := httptest.NewRecorder()
		a.server.Handler.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code)
		require.Contains(t, w.Body.String(), `"code":900227`)
	}
	for _, suffix := range []string{"?", "?targetUrls=private"} {
		homeContentCall(t, a, cookie, "POST", path+suffix, valid, 200, 900227)
	}
}
