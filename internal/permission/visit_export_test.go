package permission

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestVisitExportPermission catches accidental privilege expansion through defaults or presets.
func TestVisitExportPermission(t *testing.T) {
	require.Contains(t, UserPermissions, "short_link:export_visits")
	require.Contains(t, AdminPermissions, "short_link:export_visits")
	_, err := NormalizeForGroup(GroupUser, []string{"short_link:export_visits"})
	require.NoError(t, err)
	for _, p := range Presets() {
		if p.Key == "standard" {
			require.Contains(t, p.Permissions, "short_link:export_visits")
		} else {
			require.NotContains(t, p.Permissions, "short_link:export_visits")
		}
	}
	_, err = NormalizeForGroup(GroupGuest, []string{"short_link:export_visits"})
	require.ErrorIs(t, err, ErrProtectedPermission)
}
