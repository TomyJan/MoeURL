package user

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestTimeZoneCatalogStartup rejects corrupt data instead of broadening accepted values.
func TestTimeZoneCatalogStartup(t *testing.T) {
	for _, raw := range []string{`{`, `{}`, `null`, `[]`, `[1]`, `[null]`, `["../Asia/Tokyo"]`, `["UTC","UTC"]`, `["UTC","Asia/Tokyo"]`, `["Asia/Tokyo"]`} {
		t.Run(raw, func(t *testing.T) {
			require.Panics(t, func() { parseTimeZoneCatalog([]byte(raw)) })
		})
	}
	var zones []string
	require.NoError(t, json.Unmarshal(timeZoneCatalogJSON, &zones))
	for _, legacy := range []string{"UTC", "Asia/Shanghai", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney"} {
		t.Run("drop_"+legacy, func(t *testing.T) {
			without := slices.DeleteFunc(slices.Clone(zones), func(zone string) bool { return zone == legacy })
			raw, err := json.Marshal(without)
			require.NoError(t, err)
			require.Panics(t, func() { parseTimeZoneCatalog(raw) })
		})
	}
	loaded := parseTimeZoneCatalog(timeZoneCatalogJSON)
	for _, zone := range []string{"Pacific/Chatham", "Asia/Katmandu", "America/Port-au-Prince", "UTC"} {
		_, ok := loaded[zone]
		require.True(t, ok, "valid catalog choice %s was lost", zone)
	}
	for _, zone := range []string{"Asia/Kathmandu", " UTC", "utc", "Etc/UTC", "../Asia/Tokyo"} {
		_, ok := loaded[zone]
		require.False(t, ok, "non-catalog choice %s was accepted", zone)
	}
}
