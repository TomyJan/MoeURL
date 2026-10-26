package permission

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestAuditExportProtectedOwnership catches granting export via configurable presets or user baseline.
func TestAuditExportProtectedOwnership(t *testing.T) {
	require.Contains(t, AdminPermissions, "audit:export")
	require.NotContains(t, UserPermissions, "audit:export")
	_, err := NormalizeForGroup(GroupUser, []string{"audit:export"})
	require.ErrorIs(t, err, ErrProtectedPermission)
	_, err = NormalizeForGroup(GroupGuest, []string{"audit:export"})
	require.ErrorIs(t, err, ErrProtectedPermission)
	_, err = NormalizeForGroup(GroupAdmin, slices.DeleteFunc(slices.Clone(AdminPermissions), func(k string) bool { return k == "audit:export" }))
	require.ErrorIs(t, err, ErrProtectedPermission)
	for _, preset := range Presets() {
		require.NotContains(t, preset.Permissions, "audit:export")
	}
}
