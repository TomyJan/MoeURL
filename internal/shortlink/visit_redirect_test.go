package shortlink_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// TestRedirectVisitLimitsConsumeOnlyFinalRedirects covers direct, interactive and protected access.
func TestRedirectVisitLimitsConsumeOnlyFinalRedirects(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", permission.GroupUser, permission.UserPermissions)
	manager := shortlink.NewService(pool, permission.NewService())
	redirect := shortlink.NewRedirectService(pool, nil)
	for _, mode := range []string{"direct", "intermediate", "confirmation"} {
		for _, protected := range []bool{false, true} {
			name := mode
			if protected {
				name += " protected"
			}
			t.Run(name, func(t *testing.T) {
				input := shortlink.CreateInput{TargetURL: "https://example.com/target", RedirectMode: mode, MaxVisits: visitMax(1)}
				if protected {
					input.Password = &shortlink.PasswordInput{Mode: "set", Value: "correct horse"}
				}
				created, err := manager.Create(ctx, user, input)
				require.NoError(t, err)
				slug := created.ShortLink.Slug
				assertUsed := func(want int64) {
					t.Helper()
					var used int64
					require.NoError(t, pool.QueryRow(ctx, `select visits_used from short_link where id = $1`, created.ShortLink.ID).Scan(&used))
					require.Equal(t, want, used)
				}
				_, err = redirect.Open(ctx, slug, "wrong.example.com")
				require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
				assertUsed(0)
				opened, err := redirect.Open(ctx, slug, "go.example.com")
				require.NoError(t, err)
				if mode == "direct" && !protected {
					require.Equal(t, input.TargetURL, opened.TargetURL)
				} else {
					assertUsed(0)
					token := ""
					if protected {
						_, err := redirect.Continue(ctx, slug, "invalid-grant", "go.example.com")
						require.ErrorIs(t, err, shortlink.ErrPasswordRequired)
						assertUsed(0)
						_, err = redirect.Unlock(ctx, slug, "incorrect horse", "go.example.com")
						require.ErrorIs(t, err, shortlink.ErrInvalidPassword)
						assertUsed(0)
						grant, err := redirect.Unlock(ctx, slug, "correct horse", "go.example.com")
						require.NoError(t, err)
						token = grant.Token
					}
					_, err = redirect.Preview(ctx, slug, token, "go.example.com")
					require.NoError(t, err)
					assertUsed(0)
					continued, err := redirect.Continue(ctx, slug, token, "go.example.com")
					require.NoError(t, err)
					require.Equal(t, input.TargetURL, continued.TargetURL)
				}
				assertUsed(1)
				_, err = redirect.Open(ctx, slug, "go.example.com")
				require.ErrorIs(t, err, shortlink.ErrShortLinkExhausted)
				_, err = redirect.Preview(ctx, slug, "", "go.example.com")
				require.ErrorIs(t, err, shortlink.ErrShortLinkExhausted)
				_, err = redirect.Continue(ctx, slug, "", "go.example.com")
				require.ErrorIs(t, err, shortlink.ErrShortLinkExhausted)
				_, err = redirect.Unlock(ctx, slug, "incorrect horse", "go.example.com")
				require.ErrorIs(t, err, shortlink.ErrShortLinkExhausted)
				assertUsed(1)
			})
		}
	}
}

// TestVisitClaimRechecksManagementChangesAfterWaitingForLock prevents stale access and target decisions.
func TestVisitClaimRechecksManagementChangesAfterWaitingForLock(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", permission.GroupUser, permission.UserPermissions)
	manager := shortlink.NewService(pool, permission.NewService())
	for _, test := range []struct {
		name         string
		change       string
		wantErr      error
		wantMode     string
		wantPassword bool
		wantTarget   string
		wantUsed     int64
	}{
		{name: "disabled", change: `status = 'disabled'`, wantErr: shortlink.ErrShortLinkDisabled},
		{name: "expired", change: `expires_at = clock_timestamp() - interval '1 second'`, wantErr: shortlink.ErrShortLinkExpired},
		{name: "deleted", change: `deleted_at = clock_timestamp()`, wantErr: shortlink.ErrShortLinkMissing},
		{name: "new target", change: `target_url = 'https://example.com/new'`, wantTarget: "https://example.com/new", wantUsed: 1},
		{name: "interactive", change: `redirect_mode = 'confirmation'`, wantMode: "confirmation"},
		{name: "password", change: `password_hash = 'new-password-hash'`, wantPassword: true, wantMode: "direct"},
		{name: "cleared quota", change: `max_visits = null, visits_used = 0`, wantTarget: "https://example.com", wantMode: "direct"},
	} {
		t.Run(test.name, func(t *testing.T) {
			created, err := manager.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com", MaxVisits: visitMax(1)})
			require.NoError(t, err)
			tx, err := pool.Begin(ctx)
			require.NoError(t, err)
			t.Cleanup(func() { _ = tx.Rollback(ctx) })
			_, err = tx.Exec(ctx, `select id from short_link where id = $1 for update`, created.ShortLink.ID)
			require.NoError(t, err)
			type outcome struct {
				result shortlink.OpenResult
				err    error
			}
			completed := make(chan outcome, 1)
			go func() {
				result, err := shortlink.NewRedirectService(pool, nil).Open(ctx, created.ShortLink.Slug, "go.example.com")
				completed <- outcome{result, err}
			}()
			require.Eventually(t, func() bool {
				var waiting bool
				err := pool.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%GetShortLinkBySlugForVisitClaim%')`).Scan(&waiting)
				return err == nil && waiting
			}, 3*time.Second, 10*time.Millisecond, "claim did not reach the row lock")
			_, err = tx.Exec(ctx, `update short_link set `+test.change+` where id = $1`, created.ShortLink.ID)
			require.NoError(t, err)
			require.NoError(t, tx.Commit(ctx))
			select {
			case got := <-completed:
				if test.wantErr != nil {
					require.ErrorIs(t, got.err, test.wantErr)
				} else {
					require.NoError(t, got.err)
					require.Equal(t, test.wantTarget, got.result.TargetURL)
					require.Equal(t, test.wantPassword, got.result.RequiresPassword)
					if test.wantMode != "" {
						require.Equal(t, test.wantMode, got.result.RedirectMode)
					}
				}
			case <-time.After(3 * time.Second):
				t.Fatal("claim did not finish")
			}
			var used int64
			require.NoError(t, pool.QueryRow(ctx, `select visits_used from short_link where id = $1`, created.ShortLink.ID).Scan(&used))
			require.Equal(t, test.wantUsed, used)
		})
	}
}

// TestFailedRedirectWriteRetainsClaimWithoutAnalytics separates issued quota from response analytics.
func TestFailedRedirectWriteRetainsClaimWithoutAnalytics(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", permission.GroupUser, permission.UserPermissions)
	created, err := shortlink.NewService(pool, permission.NewService()).Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com", MaxVisits: visitMax(1)})
	require.NoError(t, err)
	recorder := &recordingRecorder{}
	redirect := shortlink.NewRedirectService(pool, nil)
	handler := shortlink.NewRedirectHandler(redirect, recorder)
	writer := &failingRedirectWriter{header: http.Header{}}
	handler.Open(writer, httptest.NewRequestWithContext(ctx, http.MethodGet, "https://go.example.com/"+created.ShortLink.Slug, nil), created.ShortLink.Slug)
	require.Empty(t, recorder.types)
	require.Equal(t, "https://example.com", writer.header.Get("Location"))
	_, err = redirect.Open(ctx, created.ShortLink.Slug, "go.example.com")
	require.ErrorIs(t, err, shortlink.ErrShortLinkExhausted)
}

// TestConcurrentFinalVisitClaimsNeverOvershoot exercises separate service instances against one database.
func TestConcurrentFinalVisitClaimsNeverOvershoot(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", permission.GroupUser, permission.UserPermissions)
	created, err := shortlink.NewService(pool, permission.NewService()).Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com", MaxVisits: visitMax(1)})
	require.NoError(t, err)
	const clients = 12
	start := make(chan struct{})
	results := make(chan error, clients)
	var workers sync.WaitGroup
	for range clients {
		workers.Go(func() {
			service := shortlink.NewRedirectService(pool, nil)
			<-start
			_, err := service.Open(ctx, created.ShortLink.Slug, "go.example.com")
			results <- err
		})
	}
	close(start)
	workers.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		} else {
			require.True(t, errors.Is(err, shortlink.ErrShortLinkExhausted), "%v", err)
		}
	}
	require.Equal(t, 1, successes)
	var used int64
	require.NoError(t, pool.QueryRow(ctx, `select visits_used from short_link where id = $1`, created.ShortLink.ID).Scan(&used))
	require.Equal(t, int64(1), used)
}

// TestExhaustedUnlockDoesNotVerifyOrRecordFailures confirms exhausted links reject even malformed passwords.
func TestExhaustedUnlockDoesNotVerifyOrRecordFailures(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", permission.GroupUser, permission.UserPermissions)
	id := insertStoredShortLink(t, ctx, pool, user.ID, "exhausted", "https://example.com", "active", false)
	_, err := pool.Exec(ctx, `update short_link set max_visits = 1, visits_used = 1, password_hash = 'unsupported-hash' where id = $1`, id)
	require.NoError(t, err)
	_, err = shortlink.NewRedirectService(pool, nil).Unlock(ctx, "exhausted", "", "go.example.com")
	require.ErrorIs(t, err, shortlink.ErrShortLinkExhausted)
	var failures int16
	require.NoError(t, pool.QueryRow(ctx, `select password_failed_attempts from short_link where id = $1`, id).Scan(&failures))
	require.Zero(t, failures)
}

// TestUnlimitedRedirectNeedsNoWritePrivileges protects the read-only default access path.
func TestUnlimitedRedirectNeedsNoWritePrivileges(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", permission.GroupUser, permission.UserPermissions)
	insertStoredShortLink(t, ctx, pool, user.ID, "unlimited", "https://example.com", "active", false)
	// A rejecting trigger catches any synchronous attempt to mutate the link.
	_, err := pool.Exec(ctx, `create function reject_visit_write() returns trigger language plpgsql as $$ begin raise exception 'unexpected write'; end $$; create trigger reject_visit_write before update on short_link for each row execute function reject_visit_write()`)
	require.NoError(t, err)
	_, err = shortlink.NewRedirectService(pool, nil).Open(ctx, "unlimited", "go.example.com")
	require.NoError(t, err)
}
