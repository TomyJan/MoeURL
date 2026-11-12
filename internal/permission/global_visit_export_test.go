package permission

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestGlobalVisitExportIsAdminOnly catches missing defaults and configurable grants.
func TestGlobalVisitExportIsAdminOnly(t *testing.T) {
	const grant = "statistics:export_visits"
	require.Contains(t, AdminPermissions, grant)
	require.NotContains(t, UserPermissions, grant)
	_, err := NormalizeForGroup(GroupAdmin, AdminPermissions)
	require.NoError(t, err)
	without := slices.DeleteFunc(slices.Clone(AdminPermissions), func(key string) bool { return key == grant })
	_, err = NormalizeForGroup(GroupAdmin, without)
	require.ErrorIs(t, err, ErrProtectedPermission)
	_, err = NormalizeForGroup(GroupUser, []string{grant})
	require.ErrorIs(t, err, ErrProtectedPermission)
	_, err = NormalizeForGroup(GroupGuest, []string{grant})
	require.ErrorIs(t, err, ErrProtectedPermission)
	for _, preset := range Presets() {
		require.NotContains(t, preset.Permissions, grant)
	}
}
