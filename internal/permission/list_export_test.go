package permission_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/stretchr/testify/require"
)

// TestShortLinkExportPermission verifies the grant is independently configurable and restricted to standard defaults.
func TestShortLinkExportPermission(t *testing.T) {
	require.Contains(t, permission.UserPermissions, "short_link:export")
	require.Contains(t, permission.AdminPermissions, "short_link:export")
	require.Contains(t, permission.Definitions(), permission.Definition{Key: "short_link:export", Category: "short_link_basic"})
	for _, preset := range permission.Presets() {
		if preset.Key == "standard" {
			require.Contains(t, preset.Permissions, "short_link:export")
		} else {
			require.NotContains(t, preset.Permissions, "short_link:export")
		}
	}
	grants, err := permission.NormalizeForGroup("user", []string{"short_link:read_own", "short_link:export"})
	require.NoError(t, err)
	require.Contains(t, grants, "short_link:export")
}
