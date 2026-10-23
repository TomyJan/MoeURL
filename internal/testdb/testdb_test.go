package testdb

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync"
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

// TestDockerProbeUsesVersion verifies availability without the daemon's costly info endpoint.
func TestDockerProbeUsesVersion(t *testing.T) {
	if _, err := exec.LookPath("docker"); err != nil {
		if dockerRequired(os.Getenv("MOEURL_TEST_REQUIRE_DOCKER")) {
			t.Fatal(err)
		}
		t.Skip("Docker CLI is not installed")
	}
	t.Setenv("DOCKER_CONTEXT", "")
	t.Setenv("DOCKER_TLS_VERIFY", "")
	t.Setenv("DOCKER_CERT_PATH", "")
	t.Setenv("DOCKER_CONFIG", t.TempDir())
	t.Setenv("DOCKER_API_VERSION", "1.54")
	for _, available := range []bool{true, false} {
		t.Run(fmt.Sprintf("available=%t", available), func(t *testing.T) {
			dockerProbeOnce = sync.Once{}
			dockerProbeErr = nil
			t.Cleanup(func() {
				dockerProbeOnce = sync.Once{}
				dockerProbeErr = nil
			})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.URL.Path == "/_ping":
					w.Header().Set("API-Version", "1.54")
					w.WriteHeader(http.StatusOK)
				case available && strings.HasSuffix(r.URL.Path, "/version"):
					w.Header().Set("Content-Type", "application/json")
					_, _ = fmt.Fprint(w, `{"Version":"29.9.1","ApiVersion":"1.54","Os":"linux","Arch":"amd64"}`)
				default:
					http.Error(w, "daemon information unavailable", http.StatusServiceUnavailable)
				}
			}))
			t.Cleanup(server.Close)
			t.Setenv("DOCKER_HOST", "tcp://"+strings.TrimPrefix(server.URL, "http://"))
			if available {
				require.NoError(t, probeDockerDaemon())
			} else {
				require.ErrorContains(t, probeDockerDaemon(), "probe Docker daemon")
			}
		})
	}
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
