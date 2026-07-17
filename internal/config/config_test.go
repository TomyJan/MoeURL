package config

import "testing"

// TestLoadReadsAnalyticsCountryHeader verifies the optional country header configuration is loaded.
func TestLoadReadsAnalyticsCountryHeader(t *testing.T) {
	t.Setenv("MOEURL_ANALYTICS_COUNTRY_HEADER", "CF-IPCountry")

	config := Load()

	if config.AnalyticsCountryHeader != "CF-IPCountry" {
		t.Fatalf("analytics country header = %q", config.AnalyticsCountryHeader)
	}
}
