package permission

import (
	"github.com/stretchr/testify/require"
	"testing"
)

// TestInsightsPermissionBoundaries validates actual configurable and protected authorization behavior.
func TestInsightsPermissionBoundaries(t *testing.T) {
	_, err := NormalizeForGroup(GroupUser, []string{"short_link:read_visits"})
	require.NoError(t, err)
	for _, key := range []string{"statistics:read_all", "audit:read"} {
		_, err := NormalizeForGroup(GroupUser, []string{key})
		require.ErrorIs(t, err, ErrProtectedPermission)
		without := make([]string, 0, len(AdminPermissions))
		for _, candidate := range AdminPermissions {
			if candidate != key {
				without = append(without, candidate)
			}
		}
		_, err = NormalizeForGroup(GroupAdmin, without)
		require.ErrorIs(t, err, ErrProtectedPermission)
	}
	for _, preset := range Presets() {
		if preset.Key == "standard" {
			require.Contains(t, preset.Permissions, "short_link:read_visits")
		} else {
			require.NotContains(t, preset.Permissions, "short_link:read_visits")
		}
		require.NotContains(t, preset.Permissions, "statistics:read_all")
		require.NotContains(t, preset.Permissions, "audit:read")
	}
}
