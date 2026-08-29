package middleware_test

import (
	"bytes"
	"encoding/json"
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
	originalBody := &trackingReadCloser{Reader: bytes.NewReader(body)}
	handler := middleware.BodyLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		read, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read boundary body: %v", err)
		}
		readBytes = len(read)
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/example", nil)
	request.Body = originalBody
	request.ContentLength = int64(len(body))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if readBytes != testJSONBodyLimit {
		t.Fatalf("read bytes = %d, want %d", readBytes, testJSONBodyLimit)
	}
	if response.Code != http.StatusNoContent {
		t.Fatalf("response status = %d, want 204", response.Code)
	}
	if !originalBody.closed {
		t.Fatal("original boundary body was not closed before handler execution")
	}
}

func TestBodyLimitLeavesReadOnlyMethodsUnrestricted(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodHead} {
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

func TestBodyLimitRejectsOversizedOptionsBeforeHandler(t *testing.T) {
	handlerCalled := false
	handler := middleware.BodyLimit(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		handlerCalled = true
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodOptions, "/api/v1/example", strings.NewReader(strings.Repeat("a", testJSONBodyLimit+1)))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if handlerCalled {
		t.Fatal("handler was called for oversized OPTIONS body")
	}
	if response.Code != http.StatusOK {
		t.Fatalf("response status = %d, want business HTTP 200", response.Code)
	}
	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode oversized OPTIONS response: %v", err)
	}
	if body.Code != 100001 {
		t.Fatalf("response code = %d, want 100001", body.Code)
	}
}

func TestBodyLimitRejectsOversizedBodyWithUnknownOrForgedLengthBeforeHandler(t *testing.T) {
	const validJSON = `{"value":"ok"}`
	payload := validJSON + strings.Repeat(" ", testJSONBodyLimit)
	tests := []struct {
		name             string
		contentLength    int64
		transferEncoding []string
	}{
		{name: "unknown_chunked_length", contentLength: -1, transferEncoding: []string{"chunked"}},
		{name: "forged_small_length", contentLength: int64(len(validJSON))},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handlerCalled := false
			handler := middleware.BodyLimit(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				handlerCalled = true
			}))
			originalBody := &trackingReadCloser{Reader: strings.NewReader(payload)}
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/example", nil)
			request.Body = originalBody
			request.ContentLength = test.contentLength
			request.TransferEncoding = test.transferEncoding
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if handlerCalled {
				t.Fatal("handler was called for oversized body")
			}
			if !originalBody.closed {
				t.Fatal("original oversized body was not closed")
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
		})
	}
}

func TestBodyLimitConstrainsUnknownChunkedLengthBeforeBusinessOperation(t *testing.T) {
	handlerCalls := 0
	businessCalls := 0
	handler := middleware.BodyLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalls++
		var payload string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			apphttp.BusinessError(w, 100001, "Invalid request")
			return
		}
		businessCalls++
		apphttp.OK(w, nil)
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/example", strings.NewReader(`"`+strings.Repeat("a", testJSONBodyLimit)+`"`))
	request.ContentLength = -1
	request.TransferEncoding = []string{"chunked"}
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if handlerCalls != 0 {
		t.Fatalf("handler calls = %d, want 0", handlerCalls)
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

func TestBodyLimitRejectsBodyReadFailureAndClosesOriginal(t *testing.T) {
	handlerCalled := false
	handler := middleware.BodyLimit(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		handlerCalled = true
	}))
	originalBody := &trackingReadCloser{Reader: failingBodyReader{}}
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/example", nil)
	request.Body = originalBody
	request.ContentLength = -1
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if handlerCalled {
		t.Fatal("handler was called after body read failed")
	}
	if !originalBody.closed {
		t.Fatal("original failed body was not closed")
	}
	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed-read response: %v", err)
	}
	if response.Code != http.StatusOK || body.Code != 100001 {
		t.Fatalf("failed-read response = HTTP %d code %d", response.Code, body.Code)
	}
}

type trackingReadCloser struct {
	io.Reader
	closed bool
}

func (body *trackingReadCloser) Close() error {
	body.closed = true
	return nil
}

type failingBodyReader struct{}

func (failingBodyReader) Read([]byte) (int, error) {
	return 0, io.ErrUnexpectedEOF
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
