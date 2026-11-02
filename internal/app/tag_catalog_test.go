package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestPersonalTagCatalogHTTP catches absent production wiring and a private empty directory being mistaken for denial.
func TestPersonalTagCatalogHTTP(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/short-link/tags", nil)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var body struct {
		Code int `json:"code"`
		Data struct {
			Items []struct {
				Tag       string `json:"tag"`
				LinkCount int64  `json:"linkCount"`
			} `json:"items"`
			HasMore bool `json:"hasMore"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	require.Zero(t, body.Code, response.Body.String())
	require.NotNil(t, body.Data.Items, "successful empty tags must serialize as []")
	require.Empty(t, body.Data.Items)
	require.False(t, body.Data.HasMore)
	require.Contains(t, response.Header().Get("Cache-Control"), "no-store")
}
