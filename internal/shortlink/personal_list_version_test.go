package shortlink_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// TestPersonalListVersionEnablesBatchTags catches a management DTO that drops the database version.
func TestPersonalListVersionEnablesBatchTags(t *testing.T) {
	pool, service, _, owner, input := batchTagsFixture(t, 1)
	const originalVersion = "2099-01-01T00:00:00.123456Z"
	_, err := pool.Exec(t.Context(), `update short_link set status='active',password_hash=null,updated_at=$2 where id=$1`, input.Items[0].ID, originalVersion)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{ShortLink: service, ShortLinkBatchTags: service, CurrentUser: batchTagsIdentity{owner}, Redirect: shortlink.NewRedirectService(pool, nil)})
	request := func(method, path, body string, authenticated bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), method, "http://go.example.com"+path, strings.NewReader(body))
		if method == http.MethodPost {
			r.Header.Set("Content-Type", "application/json")
		}
		if authenticated {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "list-version-session"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		return w
	}
	readVersion := func() string {
		t.Helper()
		w := request(http.MethodGet, "/api/v1/short-link/list", "", true)
		var response struct {
			Code int `json:"code"`
			Data struct {
				Items []struct {
					ID        string `json:"id"`
					UpdatedAt string `json:"updatedAt"`
				} `json:"items"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Zero(t, response.Code)
		require.Len(t, response.Data.Items, 1)
		require.Equal(t, input.Items[0].ID, response.Data.Items[0].ID)
		return response.Data.Items[0].UpdatedAt
	}
	version := readVersion()
	oldTime, err := time.Parse(time.RFC3339Nano, version)
	require.NoError(t, err)
	require.Equal(t, originalVersion, oldTime.UTC().Format(time.RFC3339Nano), "the real personal list must preserve the database's microsecond version")
	listed, err := service.List(t.Context(), owner, shortlink.ListInput{})
	require.NoError(t, err)
	encoded, err := json.Marshal(listed.Items[0])
	require.NoError(t, err)
	require.Contains(t, string(encoded), `"updatedAt":"`+version+`"`)
	input.Items[0].ExpectedUpdatedAt = version
	body, err := json.Marshal(input)
	require.NoError(t, err)
	w := request(http.MethodPost, "/api/v1/short-link/batch-tags", string(body), true)
	require.Contains(t, w.Body.String(), `"code":0`)
	require.Contains(t, w.Body.String(), `"changedCount":1,"unchangedCount":0`)
	updatedVersion := readVersion()
	newTime, err := time.Parse(time.RFC3339Nano, updatedVersion)
	require.NoError(t, err)
	require.Equal(t, "2099-01-01T00:00:00.123457Z", newTime.UTC().Format(time.RFC3339Nano))
	require.True(t, newTime.After(oldTime))
	w = request(http.MethodPost, "/api/v1/short-link/batch-tags", string(body), true)
	require.Contains(t, w.Body.String(), `"code":200116`)
	require.Equal(t, updatedVersion, readVersion())
	w = request(http.MethodGet, "/api/v1/public/short-link/preview?slug=handoff", "", false)
	require.Contains(t, w.Body.String(), `"code":0`)
	require.NotContains(t, w.Body.String(), `"updatedAt"`)
	require.NotContains(t, w.Body.String(), originalVersion)
	require.NotContains(t, w.Body.String(), updatedVersion)
}
