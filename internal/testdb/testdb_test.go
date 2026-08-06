package testdb

import (
	"errors"
	"testing"
)

type cleanupReporter struct {
	errors []string
}

func (r *cleanupReporter) Errorf(format string, args ...any) {
	r.errors = append(r.errors, format)
}

func TestReportCleanupError(t *testing.T) {
	reporter := &cleanupReporter{}
	reportCleanupError(reporter, "drop test database", errors.New("cleanup failed"))
	if len(reporter.errors) != 1 {
		t.Fatalf("expected one cleanup error, got %d", len(reporter.errors))
	}

	reportCleanupError(reporter, "close test database", nil)
	if len(reporter.errors) != 1 {
		t.Fatalf("expected nil errors to be ignored, got %d reports", len(reporter.errors))
	}
}

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
