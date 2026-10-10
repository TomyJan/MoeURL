package event

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
)

// TestDBRecorderDropsEventsWhenConcurrentWritesReachLimit verifies that recording remains non-blocking.
func TestDBRecorderDropsEventsWhenConcurrentWritesReachLimit(t *testing.T) {
	writer := &blockingEventWriter{
		entered: make(chan struct{}),
		release: make(chan struct{}),
		done:    make(chan struct{}),
	}
	logs := &synchronizedLogBuffer{}
	recorder := newDBRecorder(writer, slog.New(slog.NewTextHandler(logs, nil)), 1, recordTimeout)

	if err := recorder.Record(context.Background(), Event{Type: RedirectResponseSent, ShortLinkID: "00000000-0000-0000-0000-000000000301"}); err != nil {
		t.Fatalf("start blocked record: %v", err)
	}
	select {
	case <-writer.entered:
	case <-time.After(time.Second):
		t.Fatal("expected first write to start")
	}

	if err := recorder.Record(context.Background(), Event{Type: RedirectResponseSent, ShortLinkID: "00000000-0000-0000-0000-000000000302"}); err != nil {
		t.Fatalf("drop concurrent record: %v", err)
	}
	if calls := writer.CallCount(); calls != 1 {
		t.Fatalf("expected one active write, got %d", calls)
	}
	if !logs.Contains("short_link_event_record_dropped") {
		t.Fatalf("expected dropped event log, got %q", logs.String())
	}

	close(writer.release)
	<-writer.done
}

// TestDBRecorderSkipsNonStatisticalEvents verifies filtered events never enter the asynchronous writer path.
func TestDBRecorderSkipsNonStatisticalEvents(t *testing.T) {
	writer := &blockingEventWriter{
		entered: make(chan struct{}),
		release: make(chan struct{}),
		done:    make(chan struct{}),
	}
	releaseWriter := sync.OnceFunc(func() { close(writer.release) })
	t.Cleanup(releaseWriter)
	recorder := newDBRecorder(writer, slog.New(slog.NewTextHandler(&synchronizedLogBuffer{}, nil)), 1, recordTimeout)

	for _, eventType := range []string{RedirectInitiated, ConfirmationClicked} {
		if err := recorder.Record(context.Background(), Event{Type: eventType, ShortLinkID: "00000000-0000-0000-0000-000000000301"}); err != nil {
			t.Fatalf("record non-statistical event %s: %v", eventType, err)
		}
	}
	select {
	case <-writer.entered:
		releaseWriter()
		<-writer.done
		t.Fatal("expected non-statistical events to skip the writer")
	case <-time.After(time.Second):
	}

	if occupiedSlots := len(recorder.writeSlots); occupiedSlots != 0 {
		t.Fatalf("expected no queued writes, got %d", occupiedSlots)
	}
	if calls := writer.CallCount(); calls != 0 {
		t.Fatalf("expected the writer to remain unused, got %d calls", calls)
	}
}

// TestDBRecorderUsesConfiguredWriteTimeout verifies the asynchronous write uses the constructor timeout.
func TestDBRecorderUsesConfiguredWriteTimeout(t *testing.T) {
	writer := &deadlineEventWriter{remaining: make(chan time.Duration, 1)}
	recorder := newDBRecorder(writer, slog.New(slog.NewTextHandler(&synchronizedLogBuffer{}, nil)), 1, 10*time.Second)

	if err := recorder.Record(context.Background(), Event{Type: RedirectResponseSent, ShortLinkID: "00000000-0000-0000-0000-000000000301"}); err != nil {
		t.Fatalf("record event: %v", err)
	}

	select {
	case remaining := <-writer.remaining:
		if remaining < 5*time.Second || remaining > 10*time.Second {
			t.Fatalf("expected configured write timeout, got %s remaining", remaining)
		}
	case <-time.After(time.Second):
		t.Fatal("expected asynchronous write to start")
	}
}

// blockingEventWriter blocks persistence until the test releases it.
type blockingEventWriter struct {
	entered chan struct{}
	release chan struct{}
	done    chan struct{}

	mu    sync.Mutex
	calls int
}

// deadlineEventWriter captures the deadline applied to an asynchronous write.
type deadlineEventWriter struct {
	remaining chan time.Duration
}

// CreateShortLinkEvent reports the remaining context deadline to the test.
func (w *deadlineEventWriter) CreateShortLinkEvent(ctx context.Context, _ sqlc.CreateShortLinkEventParams) error {
	deadline, ok := ctx.Deadline()
	if !ok {
		w.remaining <- 0
		return nil
	}
	w.remaining <- time.Until(deadline)
	return nil
}

// CreateShortLinkEvent records the invocation and waits for the test release signal.
func (w *blockingEventWriter) CreateShortLinkEvent(context.Context, sqlc.CreateShortLinkEventParams) error {
	w.mu.Lock()
	w.calls++
	w.mu.Unlock()
	close(w.entered)
	<-w.release
	close(w.done)
	return errors.New("write stopped")
}

// CallCount returns the number of started writes.
func (w *blockingEventWriter) CallCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.calls
}

// synchronizedLogBuffer provides concurrency-safe log capture for assertions.
type synchronizedLogBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

// Write appends data to the captured log output.
func (b *synchronizedLogBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(p)
}

// Contains reports whether the captured log output contains the message.
func (b *synchronizedLogBuffer) Contains(message string) bool {
	return strings.Contains(b.String(), message)
}

// String returns the captured log output.
func (b *synchronizedLogBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}
