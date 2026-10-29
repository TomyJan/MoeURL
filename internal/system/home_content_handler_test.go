package system_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/stretchr/testify/require"
)

type homeContentPortStub struct{ err error }

func (s homeContentPortStub) PublicHomeContent(context.Context) (system.HomeContent, error) {
	return system.HomeContent{Title: "<b>plain</b>", Summary: "summary"}, s.err
}
func (s homeContentPortStub) GetHomeContent(context.Context, auth.CurrentUser) (system.HomeContentSettings, error) {
	return system.HomeContentSettings{HomeContent: system.HomeContent{Title: "<b>plain</b>"}, UpdatedAt: "2026-10-29T01:02:03.123456Z"}, s.err
}
func (s homeContentPortStub) UpdateHomeContent(context.Context, auth.CurrentUser, system.UpdateHomeContentInput) (system.HomeContentSettings, error) {
	return s.GetHomeContent(context.Background(), auth.CurrentUser{})
}

// Error responses and logs must not echo copy, SQL detail or request bodies;
// successful public projection excludes the management revision.
func TestHomeContentHandlerResponses(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{nil, 200, `"code":0`},
		{system.ErrSettingsPermissionDenied, 200, `"code":120001`},
		{system.ErrInvalidHomeContent, 200, `"code":900204`},
		{system.ErrHomeContentConflict, 200, `"code":900205`},
		{errors.New("editorial secret database value"), 500, `"code":900000`},
	} {
		var logs bytes.Buffer
		h := system.NewHomeContentHandler(homeContentPortStub{tc.err}, slog.New(slog.NewTextHandler(&logs, nil)))
		for _, method := range []func(http.ResponseWriter, *http.Request){h.Public, h.Get, h.Update} {
			r := httptest.NewRequest("POST", "/", strings.NewReader(`{"title":"editorial private draft","summary":"","expectedUpdatedAt":"2026-10-29T01:02:03.123456Z"}`))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			method(w, r)
			require.Equal(t, tc.status, w.Code)
			require.Contains(t, w.Body.String(), tc.code)
			if tc.err != nil {
				require.NotContains(t, w.Body.String(), "editorial")
			}
		}
		require.NotContains(t, logs.String(), "editorial")
	}
	h := system.NewHomeContentHandler(homeContentPortStub{}, nil)
	w := httptest.NewRecorder()
	h.Public(w, httptest.NewRequest("GET", "/", nil))
	require.NotContains(t, w.Body.String(), "updatedAt")
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{}`))
	r.Header.Set("Content-Type", "application/json")
	h.Update(httptest.NewRecorder(), r)
	w = httptest.NewRecorder()
	r = httptest.NewRequest("POST", "/", strings.NewReader(`{"title":"","summary":"","expectedUpdatedAt":"2026-10-29T01:02:03Z"} {}`))
	r.Header.Set("Content-Type", "application/json")
	h.Update(w, r)
	require.Contains(t, w.Body.String(), `"code":900204`)
	// This protocol boundary must reject simple media types before a valid JSON
	// body can become a write. The App regression proves real storage stays put.
	for _, media := range []string{"", "text/plain", "application/json; charset"} {
		r = httptest.NewRequest("POST", "/", strings.NewReader(`{"title":"T","summary":"S","expectedUpdatedAt":"2026-10-29T01:02:03Z"}`))
		r.Header.Set("Content-Type", media)
		w = httptest.NewRecorder()
		h.Update(w, r)
		require.Equal(t, 200, w.Code)
		require.Contains(t, w.Body.String(), `"code":900204`)
	}
}

type homeContentBrokenBody struct{}

func (homeContentBrokenBody) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }
func (homeContentBrokenBody) Close() error             { return nil }

func TestHomeContentHandlerUnreadableBody(t *testing.T) {
	h := system.NewHomeContentHandler(homeContentPortStub{}, nil)
	r := httptest.NewRequest("POST", "/", nil)
	r.Header.Set("Content-Type", "application/json")
	r.Body = homeContentBrokenBody{}
	w := httptest.NewRecorder()
	h.Update(w, r)
	require.Contains(t, w.Body.String(), `"code":900204`)
}
