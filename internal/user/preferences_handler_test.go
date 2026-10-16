package user_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/user"
)

type preferencesPortStub struct {
	err   error
	calls int
	input user.UpdatePreferencesInput
}

// Get supplies deterministic preference results for HTTP error-contract tests.
func (s *preferencesPortStub) Get(context.Context, auth.CurrentUser) (user.PreferencesResult, error) {
	s.calls++
	return user.PreferencesResult{}, s.err
}

// Update records decoded inputs while allowing service errors to be exercised.
func (s *preferencesPortStub) Update(_ context.Context, _ auth.CurrentUser, input user.UpdatePreferencesInput) (user.PreferencesResult, error) {
	s.calls++
	s.input = input
	return user.PreferencesResult{}, s.err
}

// TestPreferencesHandlerStrictRequest rejects malformed complete documents before invoking business logic.
func TestPreferencesHandlerStrictRequest(t *testing.T) {
	for _, body := range []string{``, `{`, `null`, `[]`, `{}`, `{"language":null,"theme":null}`, `{"language":"en","theme":null,"expectedUpdatedAt":null,"id":"other"}`, `{"language":4,"theme":null,"expectedUpdatedAt":null}`, `{"language":null,"theme":[],"expectedUpdatedAt":null}`, `{"language":null,"theme":null,"expectedUpdatedAt":4}`, `{"language":null,"theme":null,"expectedUpdatedAt":null} {}`, `{"language":null,"theme":null,"expectedUpdatedAt":null} garbage`} {
		t.Run(body, func(t *testing.T) {
			service := &preferencesPortStub{}
			handler := user.NewPreferencesHandler(service, nil)
			response := httptest.NewRecorder()
			handler.Update(response, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(body)))
			var result struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if response.Code != http.StatusOK || result.Code != 100001 || service.calls != 0 {
				t.Fatalf("status=%d code=%d calls=%d", response.Code, result.Code, service.calls)
			}
		})
	}
	for _, body := range []string{`{"language":null,"theme":null,"expectedUpdatedAt":null}`, `{"language":"en","theme":"dark","expectedUpdatedAt":"2026-10-16T00:00:00Z"}`} {
		service := &preferencesPortStub{}
		handler := user.NewPreferencesHandler(service, nil)
		response := httptest.NewRecorder()
		handler.Update(response, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(body)))
		if service.calls != 1 || !strings.Contains(response.Body.String(), `"code":0`) {
			t.Fatalf("valid request: %s", response.Body)
		}
		if strings.Contains(body, `"en"`) && (service.input.Language == nil || *service.input.Language != "en" || service.input.Theme == nil || *service.input.Theme != "dark" || service.input.ExpectedUpdatedAt == nil) {
			t.Fatalf("lost input: %#v", service.input)
		}
	}
}

// TestPreferencesHandlerErrorContract maps service failures consistently for reading and writing.
func TestPreferencesHandlerErrorContract(t *testing.T) {
	for _, tc := range []struct {
		err          error
		code, status int
	}{
		{nil, 0, 200}, {user.ErrInvalidInput, 100001, 200}, {user.ErrPermissionDenied, 120001, 200}, {user.ErrPreferencesConflict, 300104, 200}, {errors.New("database unavailable"), 900000, 500},
	} {
		for _, update := range []bool{false, true} {
			service := &preferencesPortStub{err: tc.err}
			handler := user.NewPreferencesHandler(service, slog.New(slog.NewTextHandler(io.Discard, nil)))
			response := httptest.NewRecorder()
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(`{"language":null,"theme":null,"expectedUpdatedAt":null}`))
			if update {
				handler.Update(response, request)
			} else {
				handler.Get(response, request)
			}
			var result struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Code != tc.code || response.Code != tc.status {
				t.Fatalf("err=%v update=%v status=%d code=%d", tc.err, update, response.Code, result.Code)
			}
		}
	}
}
