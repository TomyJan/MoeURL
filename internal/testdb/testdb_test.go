package testdb

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
	require.Len(t, reporter.errors, 1)
	assert.Contains(t, reporter.errors[0], "drop test database")

	reportCleanupError(reporter, "close test database", nil)
	assert.Len(t, reporter.errors, 1)
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
		assert.Equal(t, test.want, dockerRequired(test.value), test.value)
	}
}

// TestDockerProbeContextIsIndependent verifies Docker probing uses its own active timeout context.
func TestDockerProbeContextIsIndependent(t *testing.T) {
	probeContext, cancelProbe := newDockerProbeContext()
	defer cancelProbe()
	require.NoError(t, probeContext.Err())
	deadline, ok := probeContext.Deadline()
	require.True(t, ok)
	remaining := time.Until(deadline)
	assert.Greater(t, remaining, time.Duration(0))
	assert.LessOrEqual(t, remaining, dockerProbeTimeout)
}

// TestSharedContainerShutdownRunsOnce verifies process cleanup is idempotent and retains its result.
func TestSharedContainerShutdownRunsOnce(t *testing.T) {
	terminateErr := errors.New("terminate failed")
	terminateCalls := 0
	shutdown := sharedContainerShutdown{
		terminate: func() error {
			terminateCalls++
			return terminateErr
		},
	}

	require.ErrorIs(t, shutdown.run(), terminateErr)
	require.ErrorIs(t, shutdown.run(), terminateErr)
	assert.Equal(t, 1, terminateCalls)
}
