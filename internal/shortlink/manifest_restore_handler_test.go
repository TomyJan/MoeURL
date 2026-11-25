package shortlink_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/shortlink"
)

const manifestRestoreRequestID = "a1111111-1111-4111-8111-111111115609"
const manifestRestoreItemJSON = `{"domainOrigin":"https://example.org","slug":"docs7","targetUrl":"https://target.example/path","title":"","tags":[],"status":"enabled","redirectMode":"direct","intermediateDelaySeconds":"","expiresAt":"","maxVisits":""}`

func manifestRestoreBody(items ...string) string {
	return `{"requestId":"` + manifestRestoreRequestID + `","items":[` + strings.Join(items, ",") + `]}`
}

type manifestRestoreResolver struct{ user auth.CurrentUser }

func (r manifestRestoreResolver) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	return r.user, nil
}

type manifestRestorePort struct {
	calls int
	actor auth.CurrentUser
	input shortlink.ManifestRestoreInput
}

func (p *manifestRestorePort) RestoreManifest(_ context.Context, actor auth.CurrentUser, input shortlink.ManifestRestoreInput) (shortlink.BatchCreateResult, error) {
	p.calls++
	p.actor = actor
	p.input = input
	return shortlink.BatchCreateResult{RequestID: input.RequestID, CreatedCount: len(input.Items)}, nil
}

func manifestRestoreHandler(port shortlink.ManifestRestorePort, actor auth.CurrentUser) http.Handler {
	handler := shortlink.NewManifestRestoreHandler(port, nil)
	endpoint := http.HandlerFunc(handler.RestoreManifest)
	return auth.CurrentUserMiddleware(manifestRestoreResolver{user: actor})(endpoint)
}

func manifestRestoreRequest(t *testing.T, handler http.Handler, body string, query string, contentType string, expected ...string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/short-link/manifest/restore"+query, strings.NewReader(body))
	request.Header.Set("Content-Type", contentType)
	if expected != nil {
		for _, value := range expected {
			request.Header.Add("X-MoeURL-Expected-User-ID", value)
		}
	}
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "test-session"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func assertManifestRestoreEqual[T comparable](t *testing.T, want, got T) {
	t.Helper()
	if got != want {
		t.Fatalf("want %v, got %v", want, got)
	}
}

func assertManifestRestoreContains(t *testing.T, text, substring string) {
	t.Helper()
	if !strings.Contains(text, substring) {
		t.Fatalf("want %q to contain %q", text, substring)
	}
}

func assertManifestRestoreNotContains(t *testing.T, text, substring string) {
	t.Helper()
	if strings.Contains(text, substring) {
		t.Fatalf("want %q not to contain %q", text, substring)
	}
}

func TestManifestRestoreHandlerRejectsInvalidFraming(t *testing.T) {
	actor := auth.CurrentUser{ID: "user-123", Username: "alice", GroupKey: "user"}
	row := manifestRestoreItemJSON
	items101 := make([]string, 101)
	for i := range items101 {
		items101[i] = strings.Replace(row, `"docs7"`, `"docs`+strings.TrimSpace(strings.Repeat("x", i+1))+`"`, 1)
	}
	invalidUTF8 := []byte(manifestRestoreBody(row))
	invalidUTF8 = append(invalidUTF8[:strings.Index(string(invalidUTF8), `"title":""`)+len(`"title":"`)], append([]byte{0xff}, invalidUTF8[strings.Index(string(invalidUTF8), `"title":""`)+len(`"title":"`):]...)...)
	invalid := []struct {
		name        string
		body        string
		query       string
		contentType string
	}{
		{name: "query string", body: manifestRestoreBody(row), query: "?debug=1", contentType: "application/json"},
		{name: "broken top-level separator", body: `{"requestId":"` + manifestRestoreRequestID + `",,}`, contentType: "application/json"},
		{name: "non-string request id", body: `{"requestId":42,"items":[` + row + `]}`, contentType: "application/json"},
		{name: "missing row value", body: `{"requestId":"` + manifestRestoreRequestID + `","items":[{"domainOrigin":`, contentType: "application/json"},
		{name: "non-array tags", body: manifestRestoreBody(strings.Replace(row, `"tags":[]`, `"tags":"docs"`, 1)), contentType: "application/json"},
		{name: "non-string tag", body: manifestRestoreBody(strings.Replace(row, `"tags":[]`, `"tags":[42]`, 1)), contentType: "application/json"},
		{name: "eleven tags", body: manifestRestoreBody(strings.Replace(row, `"tags":[]`, `"tags":[`+strings.Repeat(`"docs",`, 10)+`"last"]`, 1)), contentType: "application/json"},
		{name: "broken tag closing", body: `{"requestId":"` + manifestRestoreRequestID + `","items":[{"tags":["docs"}`, contentType: "application/json"},
		{name: "broken tag token", body: `{"requestId":"` + manifestRestoreRequestID + `","items":[{"tags":["docs",`, contentType: "application/json"},
		{name: "non-string field", body: manifestRestoreBody(strings.Replace(row, `"title":""`, `"title":42`, 1)), contentType: "application/json"},
		{name: "duplicate top-level key", body: strings.Replace(manifestRestoreBody(row), `"requestId":"`+manifestRestoreRequestID+`",`, `"requestId":"`+manifestRestoreRequestID+`","requestId":"`+manifestRestoreRequestID+`",`, 1), contentType: "application/json"},
		{name: "unknown top-level key", body: strings.Replace(manifestRestoreBody(row), `"requestId":`, `"unknown":true,"requestId":`, 1), contentType: "application/json"},
		{name: "missing request id", body: strings.Replace(manifestRestoreBody(row), `"requestId":"`+manifestRestoreRequestID+`",`, "", 1), contentType: "application/json"},
		{name: "duplicate item key", body: manifestRestoreBody(strings.Replace(row, `"title":""`, `"title":"","title":"duplicate"`, 1)), contentType: "application/json"},
		{name: "unknown item key", body: manifestRestoreBody(strings.Replace(row, `"title":""`, `"unexpected":"x"`, 1)), contentType: "application/json"},
		{name: "missing item key", body: manifestRestoreBody(strings.Replace(row, `,"title":""`, "", 1)), contentType: "application/json"},
		{name: "null request", body: "null", contentType: "application/json"},
		{name: "non-object request", body: "[]", contentType: "application/json"},
		{name: "null items", body: `{"requestId":"` + manifestRestoreRequestID + `","items":null}`, contentType: "application/json"},
		{name: "empty items", body: `{"requestId":"` + manifestRestoreRequestID + `","items":[]}`, contentType: "application/json"},
		{name: "non-array items", body: `{"requestId":"` + manifestRestoreRequestID + `","items":{}}`, contentType: "application/json"},
		{name: "null item", body: manifestRestoreBody("null"), contentType: "application/json"},
		{name: "non-object item", body: manifestRestoreBody("[]"), contentType: "application/json"},
		{name: "101 rows", body: manifestRestoreBody(items101...), contentType: "application/json"},
		{name: "duplicate slug", body: manifestRestoreBody(row, row), contentType: "application/json"},
		{name: "noncanonical request id", body: strings.Replace(manifestRestoreBody(row), manifestRestoreRequestID, "111111111111411181111111115609", 1), contentType: "application/json"},
		{name: "uppercase request id", body: strings.Replace(manifestRestoreBody(row), manifestRestoreRequestID, strings.ToUpper(manifestRestoreRequestID), 1), contentType: "application/json"},
		{name: "zero request id", body: strings.Replace(manifestRestoreBody(row), manifestRestoreRequestID, "00000000-0000-0000-0000-000000000000", 1), contentType: "application/json"},
		{name: "unpaired high surrogate", body: strings.Replace(manifestRestoreBody(row), `"title":""`, `"title":"\ud800"`, 1), contentType: "application/json"},
		{name: "trailing JSON", body: manifestRestoreBody(row) + `{}`, contentType: "application/json"},
		{name: "invalid UTF-8", body: string(invalidUTF8), contentType: "application/json"},
		{name: "body exceeds 1 MiB", body: manifestRestoreBody(row) + strings.Repeat(" ", 1024*1024), contentType: "application/json"},
		{name: "wrong media type", body: manifestRestoreBody(row), contentType: "text/plain"},
		{name: "malformed media type", body: manifestRestoreBody(row), contentType: "application/json; broken"},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			port := &manifestRestorePort{}
			response := manifestRestoreRequest(t, manifestRestoreHandler(port, actor), tc.body, tc.query, tc.contentType)
			assertManifestRestoreEqual(t, http.StatusOK, response.Code)
			assertManifestRestoreContains(t, response.Body.String(), `"code":100001`)
			assertManifestRestoreNotContains(t, response.Body.String(), `"createdCount"`)
			assertManifestRestoreEqual(t, "no-store", response.Header().Get("Cache-Control"))
			assertManifestRestoreEqual(t, 0, port.calls)
		})
	}
}

func TestManifestRestoreHandlerBindsExpectedActor(t *testing.T) {
	actor := auth.CurrentUser{ID: "user-123", Username: "alice", GroupKey: "user"}
	t.Run("absent header keeps cookie actor semantics", func(t *testing.T) {
		port := &manifestRestorePort{}
		response := manifestRestoreRequest(t, manifestRestoreHandler(port, actor), manifestRestoreBody(manifestRestoreItemJSON), "", "application/json")
		assertManifestRestoreEqual(t, http.StatusOK, response.Code)
		assertManifestRestoreEqual(t, 1, port.calls)
		assertManifestRestoreEqual(t, actor.ID, port.actor.ID)
	})
	t.Run("matching single header is accepted", func(t *testing.T) {
		port := &manifestRestorePort{}
		response := manifestRestoreRequest(t, manifestRestoreHandler(port, actor), manifestRestoreBody(manifestRestoreItemJSON), "", "application/json", actor.ID)
		assertManifestRestoreEqual(t, http.StatusOK, response.Code)
		assertManifestRestoreEqual(t, 1, port.calls)
		assertManifestRestoreEqual(t, actor.ID, port.actor.ID)
	})
	for _, tc := range []struct {
		name   string
		values []string
	}{{name: "empty header", values: []string{""}}, {name: "different actor", values: []string{"user-456"}}, {name: "multiple headers", values: []string{"user-123", "user-456"}}} {
		t.Run(tc.name, func(t *testing.T) {
			port := &manifestRestorePort{}
			response := manifestRestoreRequest(t, manifestRestoreHandler(port, actor), manifestRestoreBody(manifestRestoreItemJSON), "", "application/json", tc.values...)
			assertManifestRestoreEqual(t, http.StatusOK, response.Code)
			assertManifestRestoreContains(t, response.Body.String(), `"code":120001`)
			assertManifestRestoreEqual(t, "no-store", response.Header().Get("Cache-Control"))
			assertManifestRestoreEqual(t, 0, port.calls)
		})
	}
}

func TestManifestRestoreHandlerPreservesPayloadAndReturnsReceipt(t *testing.T) {
	actor := auth.CurrentUser{ID: "user-123", Username: "alice", GroupKey: "user"}
	port := &manifestRestorePort{}
	row := strings.Replace(manifestRestoreItemJSON, `"tags":[]`, `"tags":["docs","saved"]`, 1)
	response := manifestRestoreRequest(t, manifestRestoreHandler(port, actor), manifestRestoreBody(row), "", "application/json; charset=utf-8", actor.ID)
	assertManifestRestoreEqual(t, http.StatusOK, response.Code)
	assertManifestRestoreEqual(t, 1, port.calls)
	assertManifestRestoreEqual(t, manifestRestoreRequestID, port.input.RequestID)
	assertManifestRestoreEqual(t, 1, len(port.input.Items))
	assertManifestRestoreEqual(t, "docs,saved", strings.Join(port.input.Items[0].Tags, ","))
	var payload struct {
		Code int `json:"code"`
		Data struct {
			RequestID    string `json:"requestId"`
			CreatedCount int    `json:"createdCount"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	assertManifestRestoreEqual(t, 0, payload.Code)
	assertManifestRestoreEqual(t, manifestRestoreRequestID, payload.Data.RequestID)
	assertManifestRestoreEqual(t, 1, payload.Data.CreatedCount)
	assertManifestRestoreEqual(t, "no-store", response.Header().Get("Cache-Control"))
}
