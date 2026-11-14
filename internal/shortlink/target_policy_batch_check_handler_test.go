package shortlink_test

import (
	"bytes"
	"encoding/json"
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

// Protocol checks also run in the handler's own package: App instrumentation
// cannot cover this package's rejection paths. Real sessions and saved rules
// ensure an accidentally accepted request becomes an observable wrong response.
func TestTargetPolicyBatchCheckHandlerProtocol(t *testing.T) {
	pool, service, actor := targetWriteFixture(t)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), actor.ID)
	require.NoError(t, err)
	handler := auth.CurrentUserMiddleware(auth.NewService(pool, time.Hour))(http.HandlerFunc(shortlink.NewTargetPolicyBatchCheckHandler(service, nil).Check))
	const valid = `{"targetUrls":["https://private.example/path?secret=fixture"]}`
	call := func(t *testing.T, url, media, body string, code int, items []shortlink.TargetPolicyBatchCheckItem) {
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
			Data *shortlink.TargetPolicyBatchCheckResult
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, code, response.Code, w.Body.String())
		if code == 0 {
			require.NotNil(t, response.Data)
			require.Equal(t, items, response.Data.Items)
		} else {
			require.Nil(t, response.Data)
		}
		for _, private := range []string{"private.example", "secret", "second.example"} {
			require.NotContains(t, w.Body.String(), private)
		}
	}
	for i, body := range []string{
		"", `[]`, `null`, `{}`, `{"`, `{"TargetUrls":["https://example.com/"]}`,
		`{"targetUrls":null}`, `{"targetUrls":[null]}`, `{"targetUrls":[3]}`, `{"targetUrls":[]}`,
		`{"targetUrls":[""]}`, `{"targetUrls":["https://example.com/"],"target\u0055rls":["https://example.com/"]}`,
		`{"targetUrls":["https://example.com/"]`, valid + `{}`, valid + `x`, strings.Repeat(" ", 262145),
		"{\"targetUrls\":[\"https://example.com/\xff\"]}", `{"targetUrls":["https://example.com/\ud800"]}`,
		`{"targetUrls":["https://example.com/\n"]}`,
	} {
		t.Run(fmt.Sprintf("malformed %d", i), func(t *testing.T) { call(t, "/", "application/json", body, 900227, nil) })
	}
	for _, media := range []string{"", "text/plain", "application/json;broken"} {
		call(t, "/", media, valid, 900227, nil)
	}
	call(t, "/?", "application/json", valid, 900227, nil)
	call(t, "/?targets=private", "application/json", valid, 900227, nil)
	call(t, "/", "application/json", valid, 0, []shortlink.TargetPolicyBatchCheckItem{{Index: 1, Outcome: "allowed"}})
	_, err = pool.Exec(t.Context(), `update system_setting set value='{"hosts":["private.example"]}' where key='security.target_host_denylist'`)
	require.NoError(t, err)
	call(t, "/", "application/json", `{"targetUrls":["https://private.example/","https://localhost/","https://second.example/","https://private.example/"]}`, 0, []shortlink.TargetPolicyBatchCheckItem{
		{Index: 1, Outcome: "restricted"}, {Index: 2, Outcome: "invalid_target"}, {Index: 3, Outcome: "allowed"}, {Index: 4, Outcome: "restricted"},
	})
	_, err = pool.Exec(t.Context(), `update user_group set permissions='["admin:access"]' where key='admin'`)
	require.NoError(t, err)
	call(t, "/", "application/json", valid, 120001, nil)
}

// A failed read cannot produce decisions from the prefix that happened to arrive.
func TestTargetPolicyBatchCheckBodyReadFailure(t *testing.T) {
	h := shortlink.NewTargetPolicyBatchCheckHandler(nil, nil)
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/", nil)
	r.Header.Set("Content-Type", "application/json")
	r.Body = io.NopCloser(failedPolicyBody{})
	w := httptest.NewRecorder()
	h.Check(w, r)
	require.Equal(t, 200, w.Code)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	require.Contains(t, w.Body.String(), `"code":900227`)
	require.Contains(t, w.Body.String(), `"data":null`)
	require.NotContains(t, w.Body.String(), "private")
}

// Infrastructure errors discard all results, use fixed text and log only a
// fixed event/request identifier, even if the input contains private credentials.
func TestTargetPolicyBatchCheckInfrastructurePrivacy(t *testing.T) {
	pool, service, _ := targetWriteFixture(t)
	pool.Close()
	var logs bytes.Buffer
	h := shortlink.NewTargetPolicyBatchCheckHandler(service, slog.New(slog.NewJSONHandler(&logs, nil)))
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(`{"targetUrls":["https://private.example/path?secret=fixture","https://second.example/"]}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Check(w, r)
	require.Equal(t, 500, w.Code)
	require.Contains(t, w.Body.String(), `"code":900000`)
	require.Contains(t, w.Body.String(), `"data":null`)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	require.Contains(t, logs.String(), "target_policy_batch_check_failed")
	for _, value := range []string{"private.example", "second.example", "secret", "closed pool", "allowed"} {
		require.NotContains(t, logs.String()+w.Body.String(), value)
	}
}
