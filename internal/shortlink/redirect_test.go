package shortlink_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/event"
	"github.com/TomyJan/MoeURL/internal/shortlink"
)

// TestRedirectServiceResolvesActiveShortLink verifies active links resolve to their target.
func TestRedirectServiceResolvesActiveShortLink(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	insertStoredShortLink(t, ctx, pool, user.ID, "abc123", "https://example.com/target", "active", false)
	recorder := &recordingRecorder{}
	service := shortlink.NewRedirectService(pool, recorder)

	result, err := service.Open(ctx, "abc123")
	if err != nil {
		t.Fatalf("resolve redirect: %v", err)
	}
	if result.TargetURL != "https://example.com/target" {
		t.Fatalf("expected target url, got %q", result.TargetURL)
	}
	if result.ShortLinkID == "" {
		t.Fatal("expected short link id")
	}
	if result.RedirectMode != shortlink.RedirectModeDirect {
		t.Fatalf("expected direct redirect mode, got %q", result.RedirectMode)
	}
	assertEvents(t, recorder.types, []string{
		event.ShortLinkOpened,
		event.AccessConditionChecked,
		event.RedirectInitiated,
	})
}

// TestRedirectServiceNormalizesSlugBeforeLookup verifies slug lookups are case-insensitive.
func TestRedirectServiceNormalizesSlugBeforeLookup(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	insertStoredShortLink(t, ctx, pool, user.ID, "abc123", "https://example.com/target", "active", false)
	service := shortlink.NewRedirectService(pool, nil)

	result, err := service.Open(ctx, "AbC123")
	if err != nil {
		t.Fatalf("resolve mixed-case slug: %v", err)
	}
	if result.TargetURL != "https://example.com/target" {
		t.Fatalf("expected target url, got %q", result.TargetURL)
	}
}

// TestRedirectServiceBlocksMissingAndDisabledShortLink verifies missing and disabled links do not resolve.
func TestRedirectServiceBlocksMissingAndDisabledShortLink(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	insertStoredShortLink(t, ctx, pool, user.ID, "disabled", "https://example.com/disabled", "disabled", false)

	tests := []struct {
		name   string
		slug   string
		err    error
		events []string
	}{
		{
			name: "missing",
			slug: "missing",
			err:  shortlink.ErrShortLinkMissing,
			events: []string{
				event.AccessConditionChecked,
				event.RedirectBlocked,
			},
		},
		{
			name: "disabled",
			slug: "disabled",
			err:  shortlink.ErrShortLinkDisabled,
			events: []string{
				event.ShortLinkOpened,
				event.AccessConditionChecked,
				event.RedirectBlocked,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := &recordingRecorder{}
			service := shortlink.NewRedirectService(pool, recorder)

			_, err := service.Open(ctx, tt.slug)
			if !errors.Is(err, tt.err) {
				t.Fatalf("expected %v, got %v", tt.err, err)
			}
			assertEvents(t, recorder.types, tt.events)
		})
	}
}

// TestRedirectServiceDoesNotRecordSuccessfulResponseEvent verifies handlers own success events.
func TestRedirectServiceDoesNotRecordSuccessfulResponseEvent(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	insertStoredShortLink(t, ctx, pool, user.ID, "active1", "https://example.com/target", "active", false)
	service := shortlink.NewRedirectService(pool, nil)

	_, err := service.Open(ctx, "active1")
	if err != nil {
		t.Fatalf("resolve active link: %v", err)
	}

	var allVisits int
	err = pool.QueryRow(ctx, `select count(*) from short_link_event where event_type = $1`, event.RedirectResponseSent).Scan(&allVisits)
	if err != nil {
		t.Fatalf("query all visits: %v", err)
	}
	if allVisits != 0 {
		t.Fatalf("expected service not to record successful response event, got %d", allVisits)
	}
}

// TestRedirectServiceReturnsDatabaseError verifies resolution returns query failures.
func TestRedirectServiceReturnsDatabaseError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	service := shortlink.NewRedirectService(pool, nil)
	pool.Close()

	_, err := service.Open(ctx, "abc123")
	if err == nil {
		t.Fatal("expected open database error")
	}
	_, err = service.Preview(ctx, "abc123")
	if err == nil {
		t.Fatal("expected preview database error")
	}
	_, err = service.Continue(ctx, "abc123")
	if err == nil {
		t.Fatal("expected continue database error")
	}
}

// TestRedirectServiceIntermediatePreviewAndContinue verifies the three public access actions and event boundaries.
func TestRedirectServiceIntermediatePreviewAndContinue(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "middle", "https://example.com/docs/path", "active", false)
	expiresAt := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	_, err := pool.Exec(ctx, `
		update short_link
		set redirect_mode = 'intermediate', intermediate_delay_seconds = 7, expires_at = $2
		where id = $1
	`, linkID, expiresAt)
	if err != nil {
		t.Fatalf("configure intermediate short link: %v", err)
	}
	recorder := &recordingRecorder{}
	service := shortlink.NewRedirectService(pool, recorder)

	opened, err := service.Open(ctx, "MiDdLe")
	if err != nil {
		t.Fatalf("open intermediate short link: %v", err)
	}
	if opened.RedirectMode != shortlink.RedirectModeIntermediate || opened.Slug != "middle" || opened.TargetURL != "" || opened.ShortLinkID == "" {
		t.Fatalf("unexpected intermediate open result: %#v", opened)
	}
	assertEvents(t, recorder.types, []string{event.ShortLinkOpened, event.AccessConditionChecked})

	recorder.types = nil
	preview, err := service.Preview(ctx, "MIDDLE")
	if err != nil {
		t.Fatalf("preview intermediate short link: %v", err)
	}
	if preview.Slug != "middle" || preview.TargetHost != "example.com" || preview.IntermediateDelaySeconds != 7 || preview.ExpiresAt == nil || !preview.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("unexpected intermediate preview: %#v", preview)
	}
	if len(recorder.types) != 0 {
		t.Fatalf("expected preview not to write events, got %#v", recorder.types)
	}
	_, err = pool.Exec(ctx, `update short_link set expires_at = null where id = $1`, linkID)
	if err != nil {
		t.Fatalf("clear intermediate expiration: %v", err)
	}
	preview, err = service.Preview(ctx, "middle")
	if err != nil || preview.ExpiresAt != nil {
		t.Fatalf("expected preview without expiration, got result %#v error %v", preview, err)
	}

	continued, err := service.Continue(ctx, "middle")
	if err != nil {
		t.Fatalf("continue intermediate short link: %v", err)
	}
	if continued.TargetURL != "https://example.com/docs/path" || continued.ShortLinkID == "" {
		t.Fatalf("unexpected continued redirect: %#v", continued)
	}
	assertEvents(t, recorder.types, []string{event.AccessConditionChecked, event.RedirectInitiated})
}

// TestRedirectServicePreviewRejectsCorruptStoredTargets verifies unexpected legacy data stays an internal error.
func TestRedirectServicePreviewRejectsCorruptStoredTargets(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	invalidID := insertStoredShortLink(t, ctx, pool, user.ID, "invalid1", "https://example.com/valid", "active", false)
	hostlessID := insertStoredShortLink(t, ctx, pool, user.ID, "hostless", "https://example.com/valid", "active", false)
	if _, err := pool.Exec(ctx, `update short_link set redirect_mode = 'intermediate', target_url = '%' where id = $1`, invalidID); err != nil {
		t.Fatalf("configure invalid stored target: %v", err)
	}
	if _, err := pool.Exec(ctx, `update short_link set redirect_mode = 'intermediate', target_url = '/relative' where id = $1`, hostlessID); err != nil {
		t.Fatalf("configure hostless stored target: %v", err)
	}
	service := shortlink.NewRedirectService(pool, nil)

	if _, err := service.Preview(ctx, "invalid1"); err == nil || !strings.Contains(err.Error(), "parse stored target URL") {
		t.Fatalf("expected stored target parse error, got %v", err)
	}
	if _, err := service.Preview(ctx, "hostless"); err == nil || !strings.Contains(err.Error(), "no hostname") {
		t.Fatalf("expected stored target hostname error, got %v", err)
	}
}

// TestRedirectServiceBlocksExpiredAndInvalidPreviewLinks verifies lifecycle checks apply to every public action.
func TestRedirectServiceBlocksExpiredAndInvalidPreviewLinks(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	expiredID := insertStoredShortLink(t, ctx, pool, user.ID, "expired", "https://example.com/expired", "active", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "direct1", "https://example.com/direct", "active", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "deleted", "https://example.com/deleted", "active", true)
	insertStoredShortLink(t, ctx, pool, user.ID, "disabled2", "https://example.com/disabled", "disabled", false)
	_, err := pool.Exec(ctx, `update short_link set redirect_mode = 'intermediate', expires_at = now() - interval '1 second' where id = $1`, expiredID)
	if err != nil {
		t.Fatalf("expire short link: %v", err)
	}
	recorder := &recordingRecorder{}
	service := shortlink.NewRedirectService(pool, recorder)
	_, err = service.Open(ctx, "expired")
	if !errors.Is(err, shortlink.ErrShortLinkExpired) {
		t.Fatalf("expected expired open error, got %v", err)
	}
	assertEvents(t, recorder.types, []string{event.ShortLinkOpened, event.AccessConditionChecked, event.RedirectBlocked})

	recorder.types = nil
	_, err = service.Continue(ctx, "expired")
	if !errors.Is(err, shortlink.ErrShortLinkExpired) {
		t.Fatalf("expected expired continue error, got %v", err)
	}
	assertEvents(t, recorder.types, []string{event.AccessConditionChecked, event.RedirectBlocked})

	recorder.types = nil
	_, err = service.Preview(ctx, "expired")
	if !errors.Is(err, shortlink.ErrShortLinkExpired) || len(recorder.types) != 0 {
		t.Fatalf("expected event-free expired preview error, got %v events %#v", err, recorder.types)
	}
	_, err = service.Preview(ctx, "direct1")
	if !errors.Is(err, shortlink.ErrShortLinkNotIntermediate) {
		t.Fatalf("expected direct preview rejection, got %v", err)
	}
	_, err = service.Preview(ctx, "deleted")
	if !errors.Is(err, shortlink.ErrShortLinkMissing) {
		t.Fatalf("expected deleted preview to be missing, got %v", err)
	}
	_, err = service.Preview(ctx, "disabled2")
	if !errors.Is(err, shortlink.ErrShortLinkDisabled) || len(recorder.types) != 0 {
		t.Fatalf("expected event-free disabled preview error, got %v events %#v", err, recorder.types)
	}
}

// TestRedirectServiceContinueRechecksEveryAccessCondition verifies final redirects cannot bypass lifecycle checks.
func TestRedirectServiceContinueRechecksEveryAccessCondition(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	insertStoredShortLink(t, ctx, pool, user.ID, "disabled3", "https://example.com/disabled", "disabled", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "direct2", "https://example.com/direct", "active", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "deleted3", "https://example.com/deleted", "active", true)

	tests := []struct {
		name   string
		slug   string
		err    error
		events []string
	}{
		{name: "missing", slug: "missing2", err: shortlink.ErrShortLinkMissing, events: []string{event.AccessConditionChecked, event.RedirectBlocked}},
		{name: "disabled", slug: "disabled3", err: shortlink.ErrShortLinkDisabled, events: []string{event.AccessConditionChecked, event.RedirectBlocked}},
		{name: "direct", slug: "direct2", err: shortlink.ErrShortLinkNotIntermediate, events: []string{event.AccessConditionChecked, event.RedirectBlocked}},
		{name: "deleted", slug: "deleted3", err: shortlink.ErrShortLinkMissing, events: []string{event.AccessConditionChecked, event.RedirectBlocked}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := &recordingRecorder{}
			service := shortlink.NewRedirectService(pool, recorder)

			_, err := service.Continue(ctx, tt.slug)
			if !errors.Is(err, tt.err) {
				t.Fatalf("expected %v, got %v", tt.err, err)
			}
			assertEvents(t, recorder.types, tt.events)
		})
	}
}

type recordingRecorder struct {
	types []string
	ids   []string
}

// Record captures redirect events for service assertions.
func (r *recordingRecorder) Record(_ context.Context, item event.Event) error {
	r.types = append(r.types, item.Type)
	r.ids = append(r.ids, item.ShortLinkID)
	return nil
}

// assertEvents verifies an ordered redirect event sequence.
func assertEvents(t *testing.T, actual []string, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("expected events %#v, got %#v", expected, actual)
	}
	for index := range expected {
		if actual[index] != expected[index] {
			t.Fatalf("expected events %#v, got %#v", expected, actual)
		}
	}
}
