package system_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/system"
)

func TestHandlerStatusReturnsInitializedFlag(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		System: &fakeSystemService{initialized: true},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/init/status", nil)

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
		Data struct {
			Initialized bool `json:"initialized"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 {
		t.Fatalf("expected code 0, got %d", body.Code)
	}
	if !body.Data.Initialized {
		t.Fatal("expected initialized true")
	}
}

func TestHandlerStatusMapsSystemError(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		System: &fakeSystemService{statusErr: errors.New("database down")},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/init/status", nil)

	router.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected http 500, got %d", response.Code)
	}
}

func TestHandlerSetupMapsAlreadyInitializedToBusinessCode(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		System: &fakeSystemService{setupErr: system.ErrAlreadyInitialized},
	})
	body := bytes.NewBufferString(`{
		"adminUsername": "admin",
		"adminPassword": "secure-password",
		"adminNickname": "Administrator",
		"siteName": "MoeURL",
		"systemDomain": "example.com",
		"shortLinkDomain": "go.example.com",
		"defaultLanguage": "zh-CN",
		"defaultTheme": "system"
	}`)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/init/setup", body)

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected http 200, got %d", response.Code)
	}

	var decoded struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if decoded.Code != 900101 {
		t.Fatalf("expected code 900101, got %d", decoded.Code)
	}
}

func TestHandlerSetupMapsInvalidInputAndSystemErrors(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		err        error
		httpStatus int
		code       int
	}{
		{name: "invalid json", body: `{`, httpStatus: http.StatusOK, code: 100001},
		{name: "invalid input", body: setupBody(), err: system.ErrInvalidSetupInput, httpStatus: http.StatusOK, code: 100001},
		{name: "system", body: setupBody(), err: errors.New("database down"), httpStatus: http.StatusInternalServerError, code: 900000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				System: &fakeSystemService{setupErr: tt.err},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/v1/init/setup", bytes.NewBufferString(tt.body))

			router.ServeHTTP(response, request)

			if response.Code != tt.httpStatus {
				t.Fatalf("expected http %d, got %d", tt.httpStatus, response.Code)
			}
			var body struct {
				Code int `json:"code"`
			}
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body.Code != tt.code {
				t.Fatalf("expected code %d, got %d", tt.code, body.Code)
			}
		})
	}
}

func TestHandlerSetupDecodesCamelCaseJSON(t *testing.T) {
	service := &fakeSystemService{}
	router := apphttp.NewRouter(apphttp.Dependencies{
		System: service,
	})
	body := bytes.NewBufferString(`{
		"adminUsername": "admin",
		"adminPassword": "secure-password",
		"adminNickname": "Administrator",
		"siteName": "MoeURL",
		"systemDomain": "example.com",
		"shortLinkDomain": "go.example.com",
		"defaultLanguage": "zh-CN",
		"defaultTheme": "system"
	}`)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/init/setup", body)

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected http 200, got %d", response.Code)
	}
	if service.setupInput.AdminUsername != "admin" {
		t.Fatalf("expected camelCase admin username to decode, got %q", service.setupInput.AdminUsername)
	}
	if service.setupInput.ShortLinkDomain != "go.example.com" {
		t.Fatalf("expected camelCase short link domain to decode, got %q", service.setupInput.ShortLinkDomain)
	}
}

type fakeSystemService struct {
	initialized bool
	statusErr   error
	setupErr    error
	setupInput  system.SetupInput
}

func (f *fakeSystemService) IsInitialized(context.Context) (bool, error) {
	if f.statusErr != nil {
		return false, f.statusErr
	}
	return f.initialized, nil
}

func (f *fakeSystemService) Setup(_ context.Context, input system.SetupInput) error {
	f.setupInput = input
	if f.setupErr != nil {
		return f.setupErr
	}
	return nil
}

func setupBody() string {
	return `{
		"adminUsername": "admin",
		"adminPassword": "secure-password",
		"adminNickname": "Administrator",
		"siteName": "MoeURL",
		"systemDomain": "example.com",
		"shortLinkDomain": "go.example.com",
		"defaultLanguage": "zh-CN",
		"defaultTheme": "system"
	}`
}
