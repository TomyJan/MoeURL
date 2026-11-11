package user

import (
	_ "embed"
	"encoding/json"
	"regexp"
)

// timeZoneCatalogJSON is the frozen Intl 2026b identifier catalog, plus UTC.
// Future expansions use another versioned file so old migrations remain reproducible.
//
//go:embed time_zone_catalog_v0600.json
var timeZoneCatalogJSON []byte

var (
	timeZoneIdentifierPattern = regexp.MustCompile(`^(UTC|[A-Za-z_+-]+(/[A-Za-z_+-]+)+)$`)
	timeZoneCatalog           = parseTimeZoneCatalog(timeZoneCatalogJSON)
)

// parseTimeZoneCatalog fails startup rather than accepting a malformed release catalog.
func parseTimeZoneCatalog(raw []byte) map[string]struct{} {
	var zones []string
	if err := json.Unmarshal(raw, &zones); err != nil || len(zones) == 0 {
		panic("invalid time-zone catalog")
	}
	result := make(map[string]struct{}, len(zones))
	for i, zone := range zones {
		if !timeZoneIdentifierPattern.MatchString(zone) || (i > 0 && zone <= zones[i-1]) {
			panic("invalid time-zone catalog order or identifier")
		}
		result[zone] = struct{}{}
	}
	for _, zone := range []string{"UTC", "Asia/Shanghai", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney"} {
		if _, ok := result[zone]; !ok {
			panic("time-zone catalog dropped a legacy identifier")
		}
	}
	return result
}
