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

type appearancePortStub struct{ err error }

func (s appearancePortStub) PublicAppearance(context.Context) (system.Appearance, error) {
	return system.Appearance{AccentPreset: "iris"}, s.err
}
func (s appearancePortStub) GetAppearance(context.Context, auth.CurrentUser) (system.AppearanceSettings, error) {
	return system.AppearanceSettings{Appearance: system.Appearance{AccentPreset: "iris"}, UpdatedAt: "2026-10-29T01:02:03.123456Z"}, s.err
}
func (s appearancePortStub) UpdateAppearance(context.Context, auth.CurrentUser, system.UpdateAppearanceInput) (system.AppearanceSettings, error) {
	return s.GetAppearance(context.Background(), auth.CurrentUser{})
}

// Error responses and logs must not echo appearance, SQL detail or request bodies;
// successful public projection excludes the management revision.
func TestAppearanceHandlerResponses(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{nil, 200, `"code":0`},
		{system.ErrSettingsPermissionDenied, 200, `"code":120001`},
		{system.ErrInvalidAppearance, 200, `"code":900206`},
		{system.ErrAppearanceConflict, 200, `"code":900207`},
		{errors.New("editorial secret database value"), 500, `"code":900000`},
	} {
		var logs bytes.Buffer
		h := system.NewAppearanceHandler(appearancePortStub{tc.err}, slog.New(slog.NewTextHandler(&logs, nil)))
		for _, method := range []func(http.ResponseWriter, *http.Request){h.Public, h.Get, h.Update} {
			r := httptest.NewRequest("POST", "/", strings.NewReader(`{"accentPreset":"forest","expectedUpdatedAt":"2026-10-29T01:02:03.123456Z"}`))
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
	h := system.NewAppearanceHandler(appearancePortStub{}, nil)
	w := httptest.NewRecorder()
	h.Public(w, httptest.NewRequest("GET", "/", nil))
	require.NotContains(t, w.Body.String(), "updatedAt")
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{}`))
	r.Header.Set("Content-Type", "application/json")
	h.Update(httptest.NewRecorder(), r)
	w = httptest.NewRecorder()
	r = httptest.NewRequest("POST", "/", strings.NewReader(`{"accentPreset":"iris","expectedUpdatedAt":"2026-10-29T01:02:03Z"} {}`))
	r.Header.Set("Content-Type", "application/json")
	h.Update(w, r)
	require.Contains(t, w.Body.String(), `"code":900206`)
	// This protocol boundary must reject simple media types before a valid JSON
	// body can become a write. The App regression proves real storage stays put.
	for _, media := range []string{"", "text/plain", "application/json; charset"} {
		r = httptest.NewRequest("POST", "/", strings.NewReader(`{"accentPreset":"ocean","expectedUpdatedAt":"2026-10-29T01:02:03Z"}`))
		r.Header.Set("Content-Type", media)
		w = httptest.NewRecorder()
		h.Update(w, r)
		require.Equal(t, 200, w.Code)
		require.Contains(t, w.Body.String(), `"code":900206`)
	}
}

type appearanceBrokenBody struct{}

func (appearanceBrokenBody) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }
func (appearanceBrokenBody) Close() error             { return nil }

func TestAppearanceHandlerUnreadableBody(t *testing.T) {
	h := system.NewAppearanceHandler(appearancePortStub{}, nil)
	r := httptest.NewRequest("POST", "/", nil)
	r.Header.Set("Content-Type", "application/json")
	r.Body = appearanceBrokenBody{}
	w := httptest.NewRecorder()
	h.Update(w, r)
	require.Contains(t, w.Body.String(), `"code":900206`)
}
