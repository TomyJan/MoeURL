package permission

import (
	"github.com/stretchr/testify/require"
	"testing"
)

// TestAnalyticsExportCatalog verifies export is configurable and restricted to the standard baseline.
func TestAnalyticsExportCatalog(t *testing.T) {
	const key = "short_link:export_statistics"
	require.Contains(t, UserPermissions, key)
	require.Contains(t, AdminPermissions, key)
	require.Contains(t, Definitions(), Definition{Key: key, Category: "short_link_basic"})
	for _, preset := range Presets() {
		if preset.Key == "standard" {
			require.Contains(t, preset.Permissions, key)
		} else {
			require.NotContains(t, preset.Permissions, key)
		}
	}
}
