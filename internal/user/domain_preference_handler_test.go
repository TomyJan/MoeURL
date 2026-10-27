package user_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/user"
)

type domainPreferenceErrorPort struct{ err error }

func (s domainPreferenceErrorPort) Get(context.Context, auth.CurrentUser) (user.DomainPreferenceResult, error) {
	return user.DomainPreferenceResult{}, s.err
}
func (s domainPreferenceErrorPort) Update(context.Context, auth.CurrentUser, user.UpdateDomainPreferenceInput) (user.DomainPreferenceResult, error) {
	return user.DomainPreferenceResult{}, s.err
}

// TestDomainPreferenceHandlerInputBoundary keeps malformed documents out of the write protocol.
func TestDomainPreferenceHandlerInputBoundary(t *testing.T) {
	h := user.NewDomainPreferenceHandler(domainPreferenceErrorPort{}, nil)
	for _, body := range []string{"", `{`, `null`, `[]`, `{}`, `{"domainId":null}`, `{"expectedUpdatedAt":null}`, `{"domainId":null,"expectedUpdatedAt":null,"userId":"other"}`, `{"domainId":2,"expectedUpdatedAt":null}`, `{"domainId":null,"expectedUpdatedAt":2}`, `{"domainId":null,"expectedUpdatedAt":null} {}`, `{"domainId":null,"expectedUpdatedAt":null} garbage`} {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.Update(w, r)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"code":100001`) || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("invalid document accepted: %q -> %s", body, w.Body.String())
		}
	}
	for _, media := range []string{"", "text/plain", "application/json; broken"} {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(`{"domainId":null,"expectedUpdatedAt":null}`))
		r.Header.Set("Content-Type", media)
		w := httptest.NewRecorder()
		h.Update(w, r)
		if !strings.Contains(w.Body.String(), `"code":100001`) {
			t.Fatalf("unsafe media type accepted: %q", media)
		}
	}
	for _, tc := range []struct {
		err  error
		code int
	}{{nil, 0}, {user.ErrInvalidInput, 100001}, {user.ErrPermissionDenied, 120001}, {user.ErrPreferencesConflict, 300104}} {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(`{"domainId":null,"expectedUpdatedAt":null}`))
		r.Header.Set("Content-Type", "application/json;charset=utf-8")
		w := httptest.NewRecorder()
		user.NewDomainPreferenceHandler(domainPreferenceErrorPort{tc.err}, nil).Update(w, r)
		var body struct{ Code int }
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Code != tc.code || w.Code != 200 {
			t.Fatalf("business mapping: %#v status=%d err=%v", body, w.Code, err)
		}
	}
}

// TestDomainPreferenceHandlerRedactsInfrastructureFailure protects responses and structured logs.
func TestDomainPreferenceHandlerRedactsInfrastructureFailure(t *testing.T) {
	var log bytes.Buffer
	h := user.NewDomainPreferenceHandler(domainPreferenceErrorPort{errors.New("sensitive-database-value")}, slog.New(slog.NewTextHandler(&log, nil)))
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		r := httptest.NewRequestWithContext(t.Context(), method, "/", strings.NewReader(`{"domainId":null,"expectedUpdatedAt":null}`))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		if method == http.MethodGet {
			h.Get(w, r)
		} else {
			h.Update(w, r)
		}
		var body struct{ Code int }
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Code != 900000 || w.Code != 500 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("infrastructure response: status=%d body=%s decode=%v", w.Code, w.Body.String(), err)
		}
		if strings.Contains(w.Body.String(), "sensitive-database-value") || strings.Contains(log.String(), "sensitive-database-value") || !strings.Contains(log.String(), "domain_preference_failed") {
			t.Fatalf("unsafe diagnostic: response=%s log=%s", w.Body.String(), log.String())
		}
	}
	// A nil logger must retain the same safe response contract.
	w := httptest.NewRecorder()
	user.NewDomainPreferenceHandler(domainPreferenceErrorPort{}, nil).Get(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"domainId":null,"updatedAt":null`) {
		t.Fatalf("nullable response with default logger: %s", w.Body.String())
	}
}
