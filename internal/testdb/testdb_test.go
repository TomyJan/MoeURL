package testdb

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

type cleanupReporter struct {
	errors []string
}

// Errorf captures cleanup diagnostics for assertions without failing a real test instance.
func (r *cleanupReporter) Errorf(format string, args ...any) {
	r.errors = append(r.errors, fmt.Sprintf(format, args...))
}

// TestReportCleanupError verifies cleanup errors include the failed operation.
func TestReportCleanupError(t *testing.T) {
	reporter := &cleanupReporter{}
	reportCleanupError(reporter, "drop test database", errors.New("cleanup failed"))
	if len(reporter.errors) != 1 {
		t.Fatalf("expected one cleanup error, got %d", len(reporter.errors))
	}
	if !strings.Contains(reporter.errors[0], "drop test database") {
		t.Fatalf("expected cleanup operation in report, got %q", reporter.errors[0])
	}

	reportCleanupError(reporter, "close test database", nil)
	if len(reporter.errors) != 1 {
		t.Fatalf("expected nil errors to be ignored, got %d reports", len(reporter.errors))
	}
}

// TestDockerRequired verifies only explicit truthy values disable database fallback.
func TestDockerRequired(t *testing.T) {
	for _, test := range []struct {
		value string
		want  bool
	}{
		{value: "1", want: true},
		{value: " TRUE ", want: true},
		{value: "0", want: false},
		{value: "false", want: false},
		{value: "", want: false},
	} {
		if got := dockerRequired(test.value); got != test.want {
			t.Fatalf("dockerRequired(%q) = %t, want %t", test.value, got, test.want)
		}
	}
}

// TestDockerProbeContextIsIndependent verifies Docker probing uses its own active timeout context.
func TestDockerProbeContextIsIndependent(t *testing.T) {
	probeContext, cancelProbe := newDockerProbeContext()
	defer cancelProbe()
	if err := probeContext.Err(); err != nil {
		t.Fatalf("expected independent probe context, got %v", err)
	}
	deadline, ok := probeContext.Deadline()
	if !ok {
		t.Fatal("expected Docker probe deadline")
	}
	if remaining := time.Until(deadline); remaining <= 0 || remaining > dockerProbeTimeout {
		t.Fatalf("unexpected Docker probe timeout %v", remaining)
	}
}
