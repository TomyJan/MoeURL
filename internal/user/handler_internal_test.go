package user

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWriteJSONReturnsInternalServerErrorForEncodingFailure(t *testing.T) {
	responseWriter := httptest.NewRecorder()

	writeJSON(responseWriter, http.StatusOK, response{
		Code:    0,
		Message: "OK",
		Data:    make(chan int),
		Meta:    map[string]any{},
	})

	if responseWriter.Code != http.StatusInternalServerError {
		t.Fatalf("expected http 500, got %d", responseWriter.Code)
	}
}
