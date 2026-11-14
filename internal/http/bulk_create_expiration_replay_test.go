package http_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// expirationLegacyProtocols uses literal old wire content and prefixes to detect compatibility drift.
var expirationLegacyProtocols = []struct{ name, path, fields, prefix, digestJSON, mode string }{
	{"targets", "/api/v1/short-link/batch-create", `"targetUrls":["https://example.org/legacy75"]`, "moeurl:bulk-create:v1:", `["https://example.org/legacy75"]`, "direct"},
	{"titles", "/api/v1/short-link/batch-create-with-titles", `"items":[{"targetUrl":"https://example.org/legacy75","title":" raw "}]`, "moeurl:bulk-create:titles:v1:", `[{"targetUrl":"https://example.org/legacy75","title":" raw "}]`, "direct"},
	{"metadata", metadataRouterEndpoint, `"items":[{"targetUrl":"https://example.org/legacy75","title":" raw ","tags":[" tag "]}]`, "moeurl:bulk-create:metadata:v1:", `[{"targetUrl":"https://example.org/legacy75","title":" raw ","tags":[" tag "]}]`, "direct"},
	{"custom", customSlugEndpoint, `"items":[{"targetUrl":"https://example.org/legacy75","title":" raw ","tags":[" tag "],"customSlug":""}]`, "moeurl:bulk-create:custom-slugs:v1:", `[{"targetUrl":"https://example.org/legacy75","title":" raw ","tags":[" tag "],"customSlug":""}]`, "direct"},
	{"modes", redirectModeEndpoint, `"items":[{"targetUrl":"https://example.org/legacy75","title":" raw ","tags":[" tag "],"customSlug":"","redirectMode":"intermediate"}]`, "moeurl:bulk-create:redirect-modes:v1:", `[{"targetUrl":"https://example.org/legacy75","title":" raw ","tags":[" tag "],"customSlug":"","redirectMode":"intermediate"}]`, "intermediate"},
}

// TestBulkExpirationLegacy detects changes to all five old digests and nullable expiration storage.
func TestBulkExpirationLegacy(t *testing.T) {
	for _, tc := range expirationLegacyProtocols {
		t.Run(tc.name, func(t *testing.T) {
			f := newExpirationRouterFixture(t)
			_, err := f.pool.Exec(t.Context(), `update domain set default_redirect_mode='confirmation'; update user_group set permissions=permissions-'short_link:set_expiration' where key='user'`)
			require.NoError(t, err)
			key := uuid.NewString()
			body := `{"requestId":"` + key + `",` + tc.fields + `}`
			code, count := f.post(tc.path, body, metadataRouterActor, true)
			require.Zero(t, code)
			require.Equal(t, 1, count)
			var mode, digest string
			var delay, unwanted int
			require.NoError(t, f.pool.QueryRow(t.Context(), `select redirect_mode,intermediate_delay_seconds from short_link`).Scan(&mode, &delay))
			require.Equal(t, tc.mode, mode)
			require.Equal(t, 5, delay)
			require.NoError(t, f.pool.QueryRow(t.Context(), `select count(*) from short_link where expires_at is not null or password_hash is not null or password_updated_at is not null or max_visits is not null`).Scan(&unwanted))
			require.Zero(t, unwanted)
			require.NoError(t, f.pool.QueryRow(t.Context(), `select encode(request_hash,'hex') from short_link_create_batch where request_id=$1::uuid`, key).Scan(&digest))
			expected := sha256.Sum256([]byte(tc.prefix + tc.digestJSON))
			require.Equal(t, hex.EncodeToString(expected[:]), digest)
			before := redirectModeSnapshot(t, f)
			code, count = f.post(tc.path, body, metadataRouterActor, true)
			require.Zero(t, code)
			require.Equal(t, 1, count)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		})
	}
}

// TestBulkExpirationProtocolConflicts catches a shared request key creating links through another protocol.
func TestBulkExpirationProtocolConflicts(t *testing.T) {
	for _, tc := range expirationLegacyProtocols {
		for _, newFirst := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/newFirst=%t", tc.name, newFirst), func(t *testing.T) {
				f := newExpirationRouterFixture(t)
				key := uuid.NewString()
				oldBody := `{"requestId":"` + key + `",` + tc.fields + `}`
				newBody := customSlugBody(key, expirationRow)
				firstPath, firstBody, secondPath, secondBody := tc.path, oldBody, expirationEndpoint, newBody
				if newFirst {
					firstPath, firstBody, secondPath, secondBody = secondPath, secondBody, firstPath, firstBody
				}
				code, _ := f.post(firstPath, firstBody, metadataRouterActor, true)
				require.Zero(t, code)
				before := redirectModeSnapshot(t, f)
				code, _ = f.post(secondPath, secondBody, metadataRouterActor, true)
				require.Equal(t, 200120, code)
				require.Equal(t, before, redirectModeSnapshot(t, f))
			})
		}
	}
}

// TestBulkExpirationDigest catches normalized title, expiry or row order replacing the raw ordered digest.
func TestBulkExpirationDigest(t *testing.T) {
	f := newExpirationRouterFixture(t)
	key := uuid.NewString()
	second := `{"targetUrl":"https://example.org/second75","title":"","tags":[],"customSlug":"","redirectMode":"","expiresAt":""}`
	body := customSlugBody(key, expirationRow+","+second)
	code, _ := f.post(expirationEndpoint, body, metadataRouterActor, true)
	require.Zero(t, code)
	before := redirectModeSnapshot(t, f)
	var digest string
	require.NoError(t, f.pool.QueryRow(t.Context(), `select encode(request_hash,'hex') from short_link_create_batch where request_id=$1::uuid`, key).Scan(&digest))
	expected := sha256.Sum256([]byte(`moeurl:bulk-create:expirations:v1:[` + expirationRow + `,` + second + `]`))
	require.Equal(t, hex.EncodeToString(expected[:]), digest)
	for _, changed := range []string{
		customSlugBody(key, second+","+expirationRow),
		strings.Replace(body, "2099-01-01T00:00:00Z", "2099-01-02T00:00:00Z", 1),
		strings.Replace(body, "2099-01-01T00:00:00Z", "", 1),
		customSlugBody(key, `{"targetUrl":"https://example.org/expiration75","title":"raw","tags":[" tag "],"customSlug":"","redirectMode":"intermediate","expiresAt":"2099-01-01T00:00:00Z"},`+second),
	} {
		code, _ := f.post(expirationEndpoint, changed, metadataRouterActor, true)
		require.Equal(t, 200120, code)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
}

// TestBulkExpirationConcurrentReplay requires four callers to share one persisted quota and receipt outcome.
func TestBulkExpirationConcurrentReplay(t *testing.T) {
	f := newExpirationRouterFixture(t)
	var input shortlink.BatchCreateWithExpirationsInput
	require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), expirationRow)), &input))
	svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
	start, done := make(chan struct{}), make(chan error, 4)
	for range 4 {
		go func() {
			<-start
			result, err := svc.BatchCreateWithExpirations(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
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
