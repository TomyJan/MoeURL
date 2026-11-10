package http_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

const customSlugEndpoint = "/api/v1/short-link/batch-create-with-custom-slugs"
const customSlugRow = `{"targetUrl":"https://example.org/custom56","title":" raw ","tags":[" tag "],"customSlug":"TeamDocs56"}`

// customSlugBody fixes the literal wire shape independently of production DTO serialization.
func customSlugBody(key, row string) string {
	return `{"requestId":"` + key + `","items":[` + row + `]}`
}

// newCustomSlugRouterFixture retains real storage and identity while exposing all four protocols.
func newCustomSlugRouterFixture(t *testing.T) metadataRouterFixture {
	t.Helper()
	f := newMetadataRouterFixture(t)
	_, err := f.pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default","short_link:set_metadata","short_link:custom_slug"]' where key='user'`)
	require.NoError(t, err)
	session, err := auth.NewSessionService(f.pool, time.Hour).Create(t.Context(), metadataRouterActor)
	require.NoError(t, err)
	svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(f.pool, time.Hour), ShortLinkBatchCreate: svc, ShortLinkBatchCreateTitles: svc, ShortLinkBatchCreateMetadata: svc, ShortLinkBatchCreateCustomSlugs: svc})
	f.post = func(path, payload, expected string, authenticated bool) (int, int) {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), "POST", path, strings.NewReader(payload))
		r.Header.Set("Content-Type", "application/json")
		if expected != "" {
			r.Header.Set("X-MoeURL-Expected-User-ID", expected)
		}
		if authenticated {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session.ID})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code, w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var body struct {
			Code int `json:"code"`
			Data struct {
				CreatedCount int `json:"createdCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		return body.Code, body.Data.CreatedCount
	}
	return f
}

// TestBulkCustomSlugStrictRouter catches malformed fields, reserved routes and normalized duplicates.
func TestBulkCustomSlugStrictRouter(t *testing.T) {
	f := newCustomSlugRouterFixture(t)
	for _, tc := range []struct {
		name, row string
		code      int
	}{
		{"missing", strings.Replace(customSlugRow, `,"customSlug":"TeamDocs56"`, "", 1), 100001},
		{"null", strings.Replace(customSlugRow, `"TeamDocs56"`, `null`, 1), 100001},
		{"number", strings.Replace(customSlugRow, `"TeamDocs56"`, `3`, 1), 100001},
		{"duplicate", strings.Replace(customSlugRow, `"customSlug":`, `"customSlug":"one","customSlug":`, 1), 100001},
		{"unknown", strings.Replace(customSlugRow, `"customSlug":`, `"ownerId":"private","customSlug":`, 1), 100001},
		{"spaces", strings.Replace(customSlugRow, `TeamDocs56`, ` TeamDocs56`, 1), 100001},
		{"short", strings.Replace(customSlugRow, `TeamDocs56`, `ab`, 1), 100001},
		{"long", strings.Replace(customSlugRow, `TeamDocs56`, strings.Repeat("a", 33), 1), 100001},
		{"unicode", strings.Replace(customSlugRow, `TeamDocs56`, `ｔｅａｍ`, 1), 100001},
		{"path", strings.Replace(customSlugRow, `TeamDocs56`, `team/docs`, 1), 100001},
		{"reserved", strings.Replace(customSlugRow, `TeamDocs56`, `LOGIN`, 1), 200102},
		{"normalized duplicate", customSlugRow + "," + strings.Replace(strings.Replace(customSlugRow, `custom56`, `other56`, 1), `TeamDocs56`, `teamdocs56`, 1), 100001},
	} {
		code, _ := f.post(customSlugEndpoint, customSlugBody(uuid.NewString(), tc.row), metadataRouterActor, true)
		require.Equal(t, tc.code, code, tc.name)
		require.Equal(t, []int{0, 0, 0}, f.counts(), tc.name)
	}
	for _, invalid := range []string{`null`, `[]`, `{}`, customSlugBody(uuid.NewString(), customSlugRow) + `{}`, strings.Replace(customSlugBody(uuid.NewString(), customSlugRow), `"items":`, `"items":[],"items":`, 1)} {
		code, _ := f.post(customSlugEndpoint, invalid, metadataRouterActor, true)
		require.Equal(t, 100001, code)
		require.Equal(t, []int{0, 0, 0}, f.counts())
	}
	code, _ := f.post(customSlugEndpoint, customSlugBody(uuid.NewString(), customSlugRow), "stale", true)
	require.Equal(t, 120001, code)
	code, _ = f.post(customSlugEndpoint, customSlugBody(uuid.NewString(), customSlugRow), "", false)
	require.Equal(t, 120001, code)
	require.Equal(t, []int{0, 0, 0}, f.counts())
}

// TestBulkCustomSlugRevokedReplay catches authorization delayed until after receipt lookup or only nonempty slugs.
func TestBulkCustomSlugRevokedReplay(t *testing.T) {
	grants := []string{"short_link:create", "domain:use_default", "short_link:set_metadata", "short_link:custom_slug"}
	for _, removed := range grants {
		t.Run(removed, func(t *testing.T) {
			f := newCustomSlugRouterFixture(t)
			body := customSlugBody(uuid.NewString(), customSlugRow)
			code, _ := f.post(customSlugEndpoint, body, metadataRouterActor, true)
			require.Zero(t, code)
			remaining := []string{}
			for _, p := range grants {
				if p != removed {
					remaining = append(remaining, p)
				}
			}
			encoded, err := json.Marshal(remaining)
			require.NoError(t, err)
			_, err = f.pool.Exec(t.Context(), `update user_group set permissions=$1::jsonb where key='user'`, string(encoded))
			require.NoError(t, err)
			for _, wire := range []string{body, customSlugBody(uuid.NewString(), strings.Replace(customSlugRow, `TeamDocs56`, "", 1))} {
				code, _ = f.post(customSlugEndpoint, wire, metadataRouterActor, true)
				require.Equal(t, 120001, code)
				require.Equal(t, []int{1, 1, 1}, f.counts())
			}
		})
	}
}

// TestBulkCustomSlugConflictRollback catches random fallback or partial writes for occupied and soft-deleted slugs.
func TestBulkCustomSlugConflictRollback(t *testing.T) {
	for _, deleted := range []bool{false, true} {
		t.Run(map[bool]string{false: "occupied", true: "soft deleted"}[deleted], func(t *testing.T) {
			f := newCustomSlugRouterFixture(t)
			code, _ := f.post(customSlugEndpoint, customSlugBody(uuid.NewString(), customSlugRow), metadataRouterActor, true)
			require.Zero(t, code)
			if deleted {
				_, err := f.pool.Exec(t.Context(), `update short_link set deleted_at=now() where slug='teamdocs56'`)
				require.NoError(t, err)
			}
			first := `{"targetUrl":"https://example.org/new-random","title":"","tags":[],"customSlug":""}`
			conflict := strings.Replace(customSlugRow, `custom56`, `conflict56`, 1)
			code, _ = f.post(customSlugEndpoint, customSlugBody(uuid.NewString(), first+","+conflict), metadataRouterActor, true)
			require.Equal(t, 200101, code)
			require.Equal(t, []int{1, 1, 1}, f.counts())
		})
	}
}

// TestBulkCustomSlugCrossProtocol catches shared request IDs reused in any of the six new/legacy directions.
func TestBulkCustomSlugCrossProtocol(t *testing.T) {
	const key = "11111111-1111-4111-8111-111111115602"
	custom := customSlugBody(key, customSlugRow)
	for _, old := range []struct{ name, path, body string }{
		{"targets", "/api/v1/short-link/batch-create", `{"requestId":"` + key + `","targetUrls":["https://example.org/old"]}`},
		{"titles", "/api/v1/short-link/batch-create-with-titles", `{"requestId":"` + key + `","items":[{"targetUrl":"https://example.org/old","title":""}]}`},
		{"metadata", metadataRouterEndpoint, `{"requestId":"` + key + `","items":[{"targetUrl":"https://example.org/old","title":"","tags":[]}]}`},
	} {
		for _, customFirst := range []bool{false, true} {
			t.Run(old.name+map[bool]string{true: " custom first", false: " old first"}[customFirst], func(t *testing.T) {
				f := newCustomSlugRouterFixture(t)
				firstPath, firstBody, secondPath, secondBody := old.path, old.body, customSlugEndpoint, custom
				if customFirst {
					firstPath, firstBody, secondPath, secondBody = secondPath, secondBody, firstPath, firstBody
				}
				code, _ := f.post(firstPath, firstBody, metadataRouterActor, true)
				require.Zero(t, code)
				code, _ = f.post(secondPath, secondBody, metadataRouterActor, true)
				require.Equal(t, 200120, code)
				require.Equal(t, []int{1, 1, 1}, f.counts())
			})
		}
	}
}

// TestBulkCustomSlugRawDigest catches lost case, raw whitespace and ordered tag content during replay.
func TestBulkCustomSlugRawDigest(t *testing.T) {
	f := newCustomSlugRouterFixture(t)
	body := customSlugBody(uuid.NewString(), customSlugRow)
	for range 2 {
		code, count := f.post(customSlugEndpoint, body, metadataRouterActor, true)
		require.Zero(t, code)
		require.Equal(t, 1, count)
	}
	for _, changed := range []string{strings.Replace(body, `TeamDocs56`, `teamdocs56`, 1), strings.Replace(body, ` raw `, `raw`, 1), strings.Replace(body, ` tag `, `tag`, 1)} {
		code, _ := f.post(customSlugEndpoint, changed, metadataRouterActor, true)
		require.Equal(t, 200120, code)
		require.Equal(t, []int{1, 1, 1}, f.counts())
	}
}

// TestBulkCustomSlugConcurrentReceipts catches duplicate batches and non-atomic global slug claims.
func TestBulkCustomSlugConcurrentReceipts(t *testing.T) {
	for _, kind := range []string{"same key", "same key changed raw case", "different key same slug"} {
		t.Run(kind, func(t *testing.T) {
			f := newCustomSlugRouterFixture(t)
			service := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
			var first, second shortlink.BatchCreateWithCustomSlugsInput
			body := customSlugBody(uuid.NewString(), customSlugRow)
			require.NoError(t, json.Unmarshal([]byte(body), &first))
			require.NoError(t, json.Unmarshal([]byte(body), &second))
			if kind == "same key changed raw case" {
				second.Items[0].CustomSlug = "teamdocs56"
			}
			if kind == "different key same slug" {
				second.RequestID = uuid.NewString()
			}
			start, done := make(chan struct{}), make(chan error, 2)
			for _, input := range []shortlink.BatchCreateWithCustomSlugsInput{first, second} {
				go func() {
					<-start
					_, err := service.BatchCreateWithCustomSlugs(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
					done <- err
				}()
			}
			close(start)
			timer := time.NewTimer(10 * time.Second)
			defer timer.Stop()
			var success, conflict int
			for range 2 {
				select {
				case err := <-done:
					if err == nil {
						success++
					} else {
						conflict++
						if kind == "different key same slug" {
							require.ErrorIs(t, err, shortlink.ErrSlugConflict)
						} else {
							require.ErrorIs(t, err, shortlink.ErrBulkCreateConflict)
						}
					}
				case <-timer.C:
					t.Fatal("concurrent writes did not settle")
				}
			}
			if kind == "same key" {
				require.Equal(t, 2, success)
				require.Zero(t, conflict)
			} else {
				require.Equal(t, 1, success)
				require.Equal(t, 1, conflict)
			}
			require.Equal(t, []int{1, 1, 1}, f.counts())
		})
	}
}

// TestBulkCustomSlugLockedRevocation catches using authority captured before the creation transaction acquired locks.
func TestBulkCustomSlugLockedRevocation(t *testing.T) {
	f := newCustomSlugRouterFixture(t)
	service := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
	tx, err := f.pool.Begin(t.Context())
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(context.Background()) }()
	_, err = tx.Exec(t.Context(), `select id from app_user where id=$1::uuid for update`, metadataRouterActor)
	require.NoError(t, err)
	var input shortlink.BatchCreateWithCustomSlugsInput
	require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), customSlugRow)), &input))
	done := make(chan error, 1)
	go func() {
		_, err := service.BatchCreateWithCustomSlugs(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
		done <- err
	}()
	require.Eventually(t, func() bool {
		var waiting bool
		err := f.pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '-- name: LockBulkCreateActor%')`).Scan(&waiting)
		return err == nil && waiting
	}, 3*time.Second, 5*time.Millisecond)
	_, err = tx.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default","short_link:set_metadata"]' where key='user'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit(t.Context()))
	select {
	case err := <-done:
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	case <-time.After(7 * time.Second):
		t.Fatal("revoked write did not settle")
	}
	require.Equal(t, []int{0, 0, 0}, f.counts())
}
