package http_test

import (
	"encoding/json"
	nethttp "net/http"
	"net/http/httptest"
	"testing"

	apphttp "github.com/TomyJan/MoeURL/internal/http"
)

func TestWriteJSONReturnsUnifiedJSONWhenEncodingFails(t *testing.T) {
	response := httptest.NewRecorder()

	apphttp.WriteJSON(response, nethttp.StatusOK, apphttp.Response{
		Code:    apphttp.CodeOK,
		Message: "OK",
		Data:    func() {},
		Meta:    nil,
	})

	if response.Code != nethttp.StatusInternalServerError {
		t.Fatalf("expected http 500, got %d", response.Code)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/json; charset=utf-8" {
		t.Fatalf("expected json content type, got %q", contentType)
	}

	var body apphttp.Response
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 500 {
		t.Fatalf("expected code 500, got %d", body.Code)
	}
	if body.Message != "Internal server error" {
		t.Fatalf("expected internal error message, got %q", body.Message)
	}
	if body.Data != nil {
		t.Fatalf("expected nil data, got %#v", body.Data)
	}
}
