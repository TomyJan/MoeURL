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
	store := &cleanupLoginStore{loginStoreStub: &loginStoreStub{}}
	store.cleanup = func(context.Context, int32) (int64, error) {
		calls++
		if calls == 2 {
			cancel()
		}
		return 0, nil
	}
	service := &LoginService{store: store}
	go func() {
		defer close(done)
		service.RunLoginAttemptCleanup(ctx, time.Millisecond, nil)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cleanup scheduler did not stop after cancellation")
	}
	if calls != 2 {
		t.Fatalf("cleanup calls = %d, want 2", calls)
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
