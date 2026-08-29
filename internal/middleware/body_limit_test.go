package middleware_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

const testJSONBodyLimit = 1 << 20

func TestBodyLimitRejectsKnownOversizeBeforeHandler(t *testing.T) {
	handlerCalled := false
	handler := middleware.BodyLimit(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		handlerCalled = true
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/example", strings.NewReader(strings.Repeat("a", testJSONBodyLimit+1)))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if handlerCalled {
		t.Fatal("handler was called for known oversized body")
	}
	if response.Code != http.StatusOK {
		t.Fatalf("response status = %d, want business HTTP 200", response.Code)
	}
	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode oversized response: %v", err)
	}
	if body.Code != 100001 {
		t.Fatalf("response code = %d, want 100001", body.Code)
	}
}

func TestBodyLimitAllowsExactBoundary(t *testing.T) {
	body := bytes.Repeat([]byte{'a'}, testJSONBodyLimit)
	readBytes := 0
	handler := middleware.BodyLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		read, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read boundary body: %v", err)
		}
		readBytes = len(read)
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/example", bytes.NewReader(body))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if readBytes != testJSONBodyLimit {
		t.Fatalf("read bytes = %d, want %d", readBytes, testJSONBodyLimit)
	}
	if response.Code != http.StatusNoContent {
		t.Fatalf("response status = %d, want 204", response.Code)
	}
}

func TestBodyLimitLeavesReadOnlyMethodsUnrestricted(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		t.Run(method, func(t *testing.T) {
			var readErr error
			handler := middleware.BodyLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, readErr = io.Copy(io.Discard, r.Body)
				w.WriteHeader(http.StatusNoContent)
			}))
			request := httptest.NewRequestWithContext(t.Context(), method, "/api/v1/example", strings.NewReader(strings.Repeat("a", testJSONBodyLimit+1)))
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if readErr != nil {
				t.Fatalf("read-only body was limited: %v", readErr)
			}
			if response.Code != http.StatusNoContent {
				t.Fatalf("response status = %d, want handler response", response.Code)
			}
		})
	}
}

func TestBodyLimitConstrainsUnknownChunkedLengthBeforeBusinessOperation(t *testing.T) {
	var decodeErr error
	businessCalls := 0
	handler := middleware.BodyLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload string
		decodeErr = json.NewDecoder(r.Body).Decode(&payload)
		if decodeErr == nil {
			businessCalls++
			apphttp.OK(w, nil)
			return
		}
		apphttp.BusinessError(w, 100001, "Invalid request")
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/example", strings.NewReader(`"`+strings.Repeat("a", testJSONBodyLimit)+`"`))
	request.ContentLength = -1
	request.TransferEncoding = []string{"chunked"}
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	var maxBytesErr *http.MaxBytesError
	if !errors.As(decodeErr, &maxBytesErr) {
		t.Fatalf("decode error = %v, want MaxBytesError", decodeErr)
	}
	if businessCalls != 0 {
		t.Fatalf("business operation calls = %d, want 0", businessCalls)
	}
	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode business response: %v", err)
	}
	if response.Code != http.StatusOK || body.Code != 100001 {
		t.Fatalf("oversized chunked response = HTTP %d code %d", response.Code, body.Code)
	}
}

func TestBodyLimitAllowsNilBody(t *testing.T) {
	handlerCalled := false
	handler := middleware.BodyLimit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/example", nil)
	request.Body = nil
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if !handlerCalled || response.Code != http.StatusNoContent {
		t.Fatalf("nil body response = called %t status %d", handlerCalled, response.Code)
	}
}
