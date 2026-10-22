package http_test

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/stretchr/testify/require"
)

// TestInsightPagesServeTheApplicationShell verifies direct navigation and refresh use the client permission guards.
func TestInsightPagesServeTheApplicationShell(t *testing.T) {
	directory := t.TempDir()
	const shell = "<!doctype html><title>Private insight application</title>"
	require.NoError(t, os.WriteFile(filepath.Join(directory, "index.html"), []byte(shell), 0o600))
	router := apphttp.NewRouter(apphttp.Dependencies{StaticDir: directory})
	for _, path := range []string{"/admin/dashboard", "/admin/audit"} {
		t.Run(path, func(t *testing.T) {
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
			require.Equal(t, 200, response.Code)
			require.Equal(t, shell, response.Body.String())
			require.Contains(t, response.Header().Get("Content-Type"), "text/html")
		})
	}
}
