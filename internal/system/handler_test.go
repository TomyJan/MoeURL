package system_test

import (
	"bytes"
	"context"
	"encoding/json"
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
	setupErr    error
	setupInput  system.SetupInput
}

func (f *fakeSystemService) IsInitialized(context.Context) (bool, error) {
	return f.initialized, nil
}

func (f *fakeSystemService) Setup(_ context.Context, input system.SetupInput) error {
	f.setupInput = input
	if f.setupErr != nil {
		return f.setupErr
	}
	return nil
}
