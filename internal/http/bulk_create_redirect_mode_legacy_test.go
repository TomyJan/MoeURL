package http_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestBulkRedirectModeLegacy pins each old protocol's digest and direct/five-second storage despite domain preferences.
func TestBulkRedirectModeLegacy(t *testing.T) {
	for _, tc := range []struct{ name, path, body, prefix, digestJSON string }{
		{"targets", "/api/v1/short-link/batch-create", `"targetUrls":["https://example.org/legacy74"]`, "moeurl:bulk-create:v1:", `["https://example.org/legacy74"]`},
		{"titles", "/api/v1/short-link/batch-create-with-titles", `"items":[{"targetUrl":"https://example.org/legacy74","title":" raw "}]`, "moeurl:bulk-create:titles:v1:", `[{"targetUrl":"https://example.org/legacy74","title":" raw "}]`},
		{"metadata", metadataRouterEndpoint, `"items":[{"targetUrl":"https://example.org/legacy74","title":" raw ","tags":[" tag "]}]`, "moeurl:bulk-create:metadata:v1:", `[{"targetUrl":"https://example.org/legacy74","title":" raw ","tags":[" tag "]}]`},
		{"custom", customSlugEndpoint, `"items":[{"targetUrl":"https://example.org/legacy74","title":" raw ","tags":[" tag "],"customSlug":""}]`, "moeurl:bulk-create:custom-slugs:v1:", `[{"targetUrl":"https://example.org/legacy74","title":" raw ","tags":[" tag "],"customSlug":""}]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newRedirectModeRouterFixture(t)
			_, err := f.pool.Exec(t.Context(), `update domain set default_redirect_mode='confirmation'`)
			require.NoError(t, err)
			key := uuid.NewString()
			body := `{"requestId":"` + key + `",` + tc.body + `}`
			code, count := f.post(tc.path, body, metadataRouterActor, true)
			require.Zero(t, code)
			require.Equal(t, 1, count)
			var mode, digest string
			var delay int
			require.NoError(t, f.pool.QueryRow(t.Context(), `select redirect_mode,intermediate_delay_seconds from short_link`).Scan(&mode, &delay))
			require.Equal(t, "direct", mode)
			require.Equal(t, 5, delay)
			require.NoError(t, f.pool.QueryRow(t.Context(), `select encode(request_hash,'hex') from short_link_create_batch where request_id=$1::uuid`, key).Scan(&digest))
			expected := sha256.Sum256([]byte(tc.prefix + tc.digestJSON))
			require.Equal(t, hex.EncodeToString(expected[:]), digest)
			before := redirectModeSnapshot(t, f)
			code, _ = f.post(tc.path, body, metadataRouterActor, true)
			require.Zero(t, code)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		})
	}
}

// TestBulkRedirectModeConcurrentReplay proves concurrent requests share one atomic quota/receipt outcome.
func TestBulkRedirectModeConcurrentReplay(t *testing.T) {
	f := newRedirectModeRouterFixture(t)
	var input shortlink.BatchCreateWithRedirectModesInput
	require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), redirectModeRow)), &input))
	svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
	start := make(chan struct{})
	done := make(chan error, 4)
	for range 4 {
		go func() {
			<-start
			result, err := svc.BatchCreateWithRedirectModes(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
			if err == nil && result.CreatedCount != 1 {
				err = fmt.Errorf("unexpected receipt: %+v", result)
			}
			done <- err
		}()
	}
	close(start)
	for range 4 {
		require.NoError(t, <-done)
	}
	require.Equal(t, []int{1, 1, 1}, f.counts())
	var used int
	require.NoError(t, f.pool.QueryRow(t.Context(), `select used from account_daily_create_usage where actor_id=$1::uuid`, metadataRouterActor).Scan(&used))
	require.Equal(t, 1, used)
}
