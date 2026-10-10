package event

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestRecorderPersistsShortLinkEvent verifies a successful redirect event reaches PostgreSQL.
func TestRecorderPersistsShortLinkEvent(t *testing.T) {
	ctx := context.Background()
	pool := eventTestPool(t, ctx)
	linkID := uuid.MustParse("00000000-0000-0000-0000-000000000301")
	insertEventRecorderFixtures(t, ctx, pool, linkID)
	writeResults := make(chan error, 1)
	recorder := newDBRecorder(
		&notifyingEventWriter{writer: sqlc.New(pool), results: writeResults},
		discardLogger(),
		recordConcurrentLimit,
		5*time.Second,
	)

	err := recorder.Record(ctx, Event{
		Type:        RedirectResponseSent,
		ShortLinkID: linkID.String(),
		Slug:        "abc123",
	})
	if err != nil {
		t.Fatalf("record event: %v", err)
	}

	select {
	case err := <-writeResults:
		if err != nil {
			t.Fatalf("persist event: %v", err)
		}
	case <-time.After(6 * time.Second):
		t.Fatal("timed out waiting for event persistence")
	}

	count := eventCount(t, ctx, pool, linkID, RedirectResponseSent)
	if count != 1 {
		t.Fatalf("expected 1 event, got %d", count)
	}
}

// TestRecorderIgnoresEventsWithoutShortLinkID verifies unidentified events are dropped.
func TestRecorderIgnoresEventsWithoutShortLinkID(t *testing.T) {
	ctx := context.Background()
	pool := eventTestPool(t, ctx)
	recorder := NewRecorder(pool, discardLogger())

	err := recorder.Record(ctx, Event{Type: RedirectBlocked, Slug: "missing"})
	if err != nil {
		t.Fatalf("record event without short link id: %v", err)
	}

	var count int
	err = pool.QueryRow(ctx, `select count(*) from short_link_event`).Scan(&count)
	if err != nil {
		t.Fatalf("query recorded events: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no persisted events, got %d", count)
	}
}

// TestRecorderIgnoresNonVisitEvents verifies only successful redirect events are persisted.
func TestRecorderIgnoresNonVisitEvents(t *testing.T) {
	ctx := context.Background()
	pool := eventTestPool(t, ctx)
	linkID := uuid.MustParse("00000000-0000-0000-0000-000000000301")
	insertEventRecorderFixtures(t, ctx, pool, linkID)
	recorder := NewRecorder(pool, discardLogger())

	for _, eventType := range []string{RedirectInitiated, ConfirmationClicked} {
		if err := recorder.Record(ctx, Event{Type: eventType, ShortLinkID: linkID.String()}); err != nil {
			t.Fatalf("record non-visit event %s: %v", eventType, err)
		}
	}
	var count int
	err := pool.QueryRow(ctx, `select count(*) from short_link_event`).Scan(&count)
	if err != nil {
		t.Fatalf("query recorded events: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no persisted events, got %d", count)
	}
}

// TestRecorderReturnsInvalidShortLinkIDError verifies malformed event identifiers are rejected.
func TestRecorderReturnsInvalidShortLinkIDError(t *testing.T) {
	ctx := context.Background()
	pool := eventTestPool(t, ctx)
	recorder := NewRecorder(pool, discardLogger())

	err := recorder.Record(ctx, Event{Type: RedirectResponseSent, ShortLinkID: "bad-id"})
	if err == nil {
		t.Fatal("expected invalid short link id error")
	}
}

// TestRecorderDropsWriteFailures verifies asynchronous database failures are logged and ignored.
func TestRecorderDropsWriteFailures(t *testing.T) {
	ctx := context.Background()
	pool := eventTestPool(t, ctx)
	logOutput := &lockedBuffer{}
	recorder := NewRecorder(pool, slog.New(slog.NewTextHandler(logOutput, nil)))
	pool.Close()

	err := recorder.Record(ctx, Event{
		Type:        RedirectResponseSent,
		ShortLinkID: "00000000-0000-0000-0000-000000000301",
	})
	if err != nil {
		t.Fatalf("expected write failure to be dropped, got %v", err)
	}
	waitForLogMessage(t, logOutput, "short_link_event_record_failed")
}

// TestNoopRecorderIgnoresEvents verifies the no-op recorder always succeeds.
func TestNoopRecorderIgnoresEvents(t *testing.T) {
	err := (NoopRecorder{}).Record(context.Background(), Event{Type: RedirectBlocked, Slug: "missing"})
	if err != nil {
		t.Fatalf("expected noop recorder to ignore event, got %v", err)
	}
}

// discardLogger creates a logger that suppresses expected test diagnostics.
func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// insertEventRecorderFixtures creates the short-link rows required by recorder tests.
func insertEventRecorderFixtures(t *testing.T, ctx context.Context, pool *pgxpool.Pool, linkID uuid.UUID) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000001', 'user', 'User', '', '[]'::jsonb, true, now(), now())
	`)
	if err != nil {
		t.Fatalf("insert user group fixture: %v", err)
	}
	_, err = pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000201', 'alice', 'hash', 'Alice', '00000000-0000-0000-0000-000000000001', 'active', false, now(), now())
	`)
	if err != nil {
		t.Fatalf("insert app user fixture: %v", err)
	}
	_, err = pool.Exec(ctx, `
		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000101', 'go.example.com', 'Default', 'short_link', true, true, now(), now())
	`)
	if err != nil {
		t.Fatalf("insert domain fixture: %v", err)
	}
	_, err = pool.Exec(ctx, `
		insert into short_link (id, owner_id, domain_id, slug, target_url, status, created_at, updated_at)
		values ($1, '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'abc123', 'https://example.com', 'active', now(), now())
	`, linkID)
	if err != nil {
		t.Fatalf("insert short link fixture: %v", err)
	}
}

// eventCount returns the number of matching persisted events.
func eventCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, linkID uuid.UUID, eventType string) int {
	t.Helper()
	var count int
	err := pool.QueryRow(ctx, `
			select count(*)
			from short_link_event
			where short_link_id = $1 and event_type = $2
		`, linkID, eventType).Scan(&count)
	if err != nil {
		t.Fatalf("query recorded event: %v", err)
	}
	return count
}

// notifyingEventWriter reports completion after delegating a real database write.
type notifyingEventWriter struct {
	writer  shortLinkEventWriter
	results chan<- error
}

// CreateShortLinkEvent persists the event and reports the result to the test.
func (w *notifyingEventWriter) CreateShortLinkEvent(ctx context.Context, params sqlc.CreateShortLinkEventParams) error {
	err := w.writer.CreateShortLinkEvent(ctx, params)
	w.results <- err
	return err
}

// waitForLogMessage waits for the asynchronous recorder to emit a diagnostic.
func waitForLogMessage(t *testing.T, output *lockedBuffer, message string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if strings.Contains(output.String(), message) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected log message %q, got %q", message, output.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

type lockedBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

// Write appends logger output while synchronizing concurrent recorder access.
func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(p)
}

// String returns a synchronized snapshot of logger output.
func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

// eventTestPool opens a migrated PostgreSQL pool for recorder integration tests.
func eventTestPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	databaseURL := testdb.ProjectMigratedDatabaseURL(ctx, t)
	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
