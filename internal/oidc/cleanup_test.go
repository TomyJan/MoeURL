package oidc

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"
)

// TestRunLoginAttemptCleanupCycleUsesBoundedBatches verifies cleanup capacity and early completion.
func TestRunLoginAttemptCleanupCycleUsesBoundedBatches(t *testing.T) {
	for _, test := range []struct {
		name      string
		rows      []int64
		wantCalls int
	}{
		{name: "short batch", rows: []int64{500, 12}, wantCalls: 2},
		{name: "bounded full batches", rows: []int64{500, 500, 500, 500, 500}, wantCalls: 4},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			err := runLoginAttemptCleanupCycle(t.Context(), func(context.Context, int32) (int64, error) {
				value := test.rows[calls]
				calls++
				return value, nil
			})
			if err != nil || calls != test.wantCalls {
				t.Fatalf("cleanup = calls %d error %v, want %d", calls, err, test.wantCalls)
			}
		})
	}
}

// TestRunLoginAttemptCleanupCycleStopsOnError verifies a failed batch does not continue deleting.
func TestRunLoginAttemptCleanupCycleStopsOnError(t *testing.T) {
	wantErr := errors.New("database unavailable")
	calls := 0
	err := runLoginAttemptCleanupCycle(t.Context(), func(context.Context, int32) (int64, error) {
		calls++
		return 0, wantErr
	})
	if !errors.Is(err, wantErr) || calls != 1 {
		t.Fatalf("cleanup error = %v calls = %d", err, calls)
	}
}

// TestLoginServiceRunLoginAttemptCleanupRunsImmediatelyAndOnTicker verifies the scheduler lifecycle.
func TestLoginServiceRunLoginAttemptCleanupRunsImmediatelyAndOnTicker(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	calls := 0
	entered := make(chan int, 2)
	store := &cleanupLoginStore{loginStoreStub: &loginStoreStub{}}
	store.cleanup = func(cleanupContext context.Context, _ int32) (int64, error) {
		calls++
		entered <- calls
		if calls == 2 {
			<-cleanupContext.Done()
			return 0, cleanupContext.Err()
		}
		return 0, nil
	}
	service := &LoginService{store: store}
	go func() {
		defer close(done)
		service.RunLoginAttemptCleanup(ctx, 10*time.Millisecond, nil)
	}()
	for want := 1; want <= 2; want++ {
		select {
		case got := <-entered:
			if got != want {
				t.Fatalf("cleanup call = %d, want %d", got, want)
			}
		case <-time.After(time.Second):
			t.Fatalf("cleanup call %d did not start", want)
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cleanup scheduler did not stop after cancellation")
	}
	if calls != 2 {
		t.Fatalf("cleanup calls = %d, want 2", calls)
	}
}

// TestLoginServiceRunLoginAttemptCleanupBoundsEachCycle verifies batches share a canceled, timed cycle context.
func TestLoginServiceRunLoginAttemptCleanupBoundsEachCycle(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan struct{})
	contexts := make(chan context.Context, 2)
	calls := 0
	store := &cleanupLoginStore{loginStoreStub: &loginStoreStub{}}
	store.cleanup = func(cycleContext context.Context, _ int32) (int64, error) {
		calls++
		contexts <- cycleContext
		if calls == 1 {
			return int64(loginAttemptCleanupBatchSize), nil
		}
		return 0, nil
	}
	go func() {
		defer close(done)
		(&LoginService{store: store}).RunLoginAttemptCleanup(ctx, time.Hour, nil)
	}()
	var first, second context.Context
	select {
	case first = <-contexts:
	case <-time.After(time.Second):
		t.Fatal("first cleanup batch did not start")
	}
	select {
	case second = <-contexts:
	case <-time.After(time.Second):
		t.Fatal("second cleanup batch did not start")
	}
	deadline, bounded := first.Deadline()
	if !bounded || time.Until(deadline) <= 0 || time.Until(deadline) > time.Minute {
		t.Fatalf("cleanup cycle deadline = %v, bounded = %t", deadline, bounded)
	}
	if first != second {
		t.Fatal("cleanup batches did not share the cycle context")
	}
	select {
	case <-first.Done():
	case <-time.After(time.Second):
		t.Fatal("finished cleanup cycle context was not canceled")
	}
	if ctx.Err() != nil {
		t.Fatal("cleanup cycle canceled its parent context")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cleanup scheduler did not stop")
	}
}

// TestLoginServiceRunLoginAttemptCleanupRejectsInvalidDependencies verifies startup failures are bounded and logged.
func TestLoginServiceRunLoginAttemptCleanupRejectsInvalidDependencies(t *testing.T) {
	for _, test := range []struct {
		name     string
		service  *LoginService
		interval time.Duration
		category string
	}{
		{name: "interval", service: &LoginService{store: &loginStoreStub{}}, interval: 0, category: "invalid_interval"},
		{name: "store", service: &LoginService{store: &loginStoreStub{}}, interval: time.Minute, category: "database_unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var logs bytes.Buffer
			test.service.RunLoginAttemptCleanup(t.Context(), test.interval, slog.New(slog.NewJSONHandler(&logs, nil)))
			if !strings.Contains(logs.String(), test.category) {
				t.Fatalf("cleanup log = %s", logs.String())
			}
		})
	}

	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	var logs bytes.Buffer
	store := &cleanupLoginStore{loginStoreStub: &loginStoreStub{}, cleanup: func(context.Context, int32) (int64, error) {
		return 0, errors.New("database unavailable")
	}}
	(&LoginService{store: store}).RunLoginAttemptCleanup(ctx, time.Minute, slog.New(slog.NewJSONHandler(&logs, nil)))
	if !strings.Contains(logs.String(), "error_type") {
		t.Fatalf("cleanup failure log = %s", logs.String())
	}
}

type cleanupLoginStore struct {
	*loginStoreStub
	cleanup func(context.Context, int32) (int64, error)
}

func (s *cleanupLoginStore) DeleteExpiredOIDCLoginAttempts(ctx context.Context, batchSize int32) (int64, error) {
	return s.cleanup(ctx, batchSize)
}
