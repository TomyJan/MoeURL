package shortlink_test

import (
	"context"
	"errors"
	"testing"

	"github.com/TomyJan/MoeURL/internal/event"
	"github.com/TomyJan/MoeURL/internal/shortlink"
)

func TestRedirectServiceResolvesActiveShortLink(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	insertStoredShortLink(t, ctx, pool, user.ID, "abc123", "https://example.com/target", "active", false)
	recorder := &recordingRecorder{}
	service := shortlink.NewRedirectService(pool, recorder)

	result, err := service.Resolve(ctx, "abc123")
	if err != nil {
		t.Fatalf("resolve redirect: %v", err)
	}
	if result.TargetURL != "https://example.com/target" {
		t.Fatalf("expected target url, got %q", result.TargetURL)
	}
	assertEvents(t, recorder.types, []string{
		event.ShortLinkOpened,
		event.AccessConditionChecked,
		event.RedirectInitiated,
		event.RedirectResponseSent,
	})
}

func TestRedirectServiceNormalizesSlugBeforeLookup(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	insertStoredShortLink(t, ctx, pool, user.ID, "abc123", "https://example.com/target", "active", false)
	service := shortlink.NewRedirectService(pool, nil)

	result, err := service.Resolve(ctx, "AbC123")
	if err != nil {
		t.Fatalf("resolve mixed-case slug: %v", err)
	}
	if result.TargetURL != "https://example.com/target" {
		t.Fatalf("expected target url, got %q", result.TargetURL)
	}
}

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

			_, err := service.Resolve(ctx, tt.slug)
			if !errors.Is(err, tt.err) {
				t.Fatalf("expected %v, got %v", tt.err, err)
			}
			assertEvents(t, recorder.types, tt.events)
		})
	}
}

func TestRedirectServiceReturnsDatabaseError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	service := shortlink.NewRedirectService(pool, nil)
	pool.Close()

	_, err := service.Resolve(ctx, "abc123")
	if err == nil {
		t.Fatal("expected database error")
	}
}

type recordingRecorder struct {
	types []string
}

func (r *recordingRecorder) Record(_ context.Context, item event.Event) error {
	r.types = append(r.types, item.Type)
	return nil
}

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
