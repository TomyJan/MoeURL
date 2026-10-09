package system_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/system"
)

// TestSettingsHandlerServesPublicAndAdministrativeSettings verifies routes and no-store responses.
func TestSettingsHandlerServesPublicAndAdministrativeSettings(t *testing.T) {
	service := &fakeSettingsService{
		public:   system.PublicConfig{SiteName: "MoeURL", DefaultLanguage: "zh-CN", DefaultTheme: "system", ShowPoweredBy: true},
		settings: system.Settings{PublicConfig: system.PublicConfig{SiteName: "MoeURL"}, LocalLoginEnabled: true, UpdatedAt: "2026-10-09T00:00:00Z"},
	}
	router := apphttp.NewRouter(apphttp.Dependencies{SystemSettings: service})
	for _, path := range []string{"/api/v1/system/public-config", "/api/v1/admin/system/settings"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s status=%d cache=%q", path, response.Code, response.Header().Get("Cache-Control"))
		}
		var body struct {
			Code int `json:"code"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil || body.Code != 0 {
			t.Fatalf("%s response code=%d error=%v", path, body.Code, err)
		}
	}
}

// TestNewSettingsHandlerUsesDefaultLogger verifies direct construction remains safe.
func TestNewSettingsHandlerUsesDefaultLogger(t *testing.T) {
	if system.NewSettingsHandler(&fakeSettingsService{}, nil) == nil {
		t.Fatal("expected settings handler")
	}
}

// TestSettingsHandlerUpdatesAndRejectsTrailingJSON verifies strict request decoding.
func TestSettingsHandlerUpdatesAndRejectsTrailingJSON(t *testing.T) {
	service := &fakeSettingsService{settings: system.Settings{UpdatedAt: "2026-10-09T00:00:01Z"}}
	router := apphttp.NewRouter(apphttp.Dependencies{SystemSettings: service})
	valid := `{"siteName":"MoeURL","defaultLanguage":"en","defaultTheme":"dark","footerText":"","showPoweredBy":true,"localLoginEnabled":true,"expectedUpdatedAt":"2026-10-09T00:00:00Z"}`

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/admin/system/settings/update", bytes.NewBufferString(valid)))
	if response.Code != http.StatusOK || service.updateInput.SiteName != "MoeURL" {
		t.Fatalf("valid update status=%d input=%#v", response.Code, service.updateInput)
	}

	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/admin/system/settings/update", bytes.NewBufferString(valid+` {}`)))
	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil || body.Code != system.CodeInvalidSettings {
		t.Fatalf("trailing JSON code=%d error=%v", body.Code, err)
	}

	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/admin/system/settings/update", bytes.NewBufferString(`{`)))
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil || body.Code != system.CodeInvalidSettings {
		t.Fatalf("malformed JSON code=%d error=%v", body.Code, err)
	}

	for _, payload := range []string{
		`{"siteName":"MoeURL","defaultLanguage":"en","defaultTheme":"dark","showPoweredBy":true,"localLoginEnabled":true,"expectedUpdatedAt":"2026-10-09T00:00:00Z"}`,
		`{"siteName":"MoeURL","defaultLanguage":"en","defaultTheme":"dark","footerText":"","showPoweredBy":true,"expectedUpdatedAt":"2026-10-09T00:00:00Z"}`,
		`{"siteName":"MoeURL","defaultLanguage":"en","defaultTheme":"dark","footerText":"","showPoweredBy":true,"localLoginEnabled":true,"expectedUpdatedAt":"2026-10-09T00:00:00Z","unexpected":true}`,
	} {
		response = httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/admin/system/settings/update", bytes.NewBufferString(payload)))
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil || body.Code != system.CodeInvalidSettings {
			t.Fatalf("incomplete or unknown settings payload %s code=%d error=%v", payload, body.Code, err)
		}
	}
}

// TestSettingsHandlerMapsReadErrors verifies both read endpoints sanitize failures.
func TestSettingsHandlerMapsReadErrors(t *testing.T) {
	service := &fakeSettingsService{publicErr: errors.New("public failed"), settingsErr: system.ErrSettingsPermissionDenied}
	router := apphttp.NewRouter(apphttp.Dependencies{SystemSettings: service})
	for _, test := range []struct {
		path       string
		wantStatus int
		wantCode   int
	}{
		{path: "/api/v1/system/public-config", wantStatus: http.StatusInternalServerError, wantCode: 900000},
		{path: "/api/v1/admin/system/settings", wantStatus: http.StatusOK, wantCode: 120001},
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
		var body struct {
			Code int `json:"code"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil || response.Code != test.wantStatus || body.Code != test.wantCode {
			t.Fatalf("%s status=%d code=%d error=%v", test.path, response.Code, body.Code, err)
		}
	}
}

// TestSettingsHandlerMapsBusinessAndInfrastructureErrors verifies the stable error contract.
func TestSettingsHandlerMapsBusinessAndInfrastructureErrors(t *testing.T) {
	for _, test := range []struct {
		name       string
		err        error
		wantStatus int
		wantCode   int
	}{
		{name: "permission", err: system.ErrSettingsPermissionDenied, wantStatus: http.StatusOK, wantCode: 120001},
		{name: "invalid", err: system.ErrInvalidSettings, wantStatus: http.StatusOK, wantCode: system.CodeInvalidSettings},
		{name: "conflict", err: system.ErrSettingsConflict, wantStatus: http.StatusOK, wantCode: system.CodeSettingsConflict},
		{name: "provider", err: system.ErrNoLoginProvider, wantStatus: http.StatusOK, wantCode: system.CodeNoLoginProvider},
		{name: "infrastructure", err: errors.New("database down"), wantStatus: http.StatusInternalServerError, wantCode: 900000},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := &fakeSettingsService{updateErr: test.err}
			router := apphttp.NewRouter(apphttp.Dependencies{SystemSettings: service})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/admin/system/settings/update", bytes.NewBufferString(`{"siteName":"MoeURL","defaultLanguage":"en","defaultTheme":"system","footerText":"","showPoweredBy":true,"localLoginEnabled":true,"expectedUpdatedAt":"2026-10-09T00:00:00Z"}`)))
			var body struct {
				Code int `json:"code"`
			}
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil || response.Code != test.wantStatus || body.Code != test.wantCode {
				t.Fatalf("response status=%d code=%d decode=%v", response.Code, body.Code, err)
			}
		})
	}
}

type fakeSettingsService struct {
	public      system.PublicConfig
	settings    system.Settings
	publicErr   error
	settingsErr error
	updateErr   error
	updateInput system.UpdateSettingsInput
}

func (s *fakeSettingsService) PublicConfig(context.Context) (system.PublicConfig, error) {
	return s.public, s.publicErr
}

func (s *fakeSettingsService) GetSettings(context.Context, auth.CurrentUser) (system.Settings, error) {
	return s.settings, s.settingsErr
}

func (s *fakeSettingsService) UpdateSettings(_ context.Context, _ auth.CurrentUser, input system.UpdateSettingsInput) (system.Settings, error) {
	s.updateInput = input
	return s.settings, s.updateErr
}
