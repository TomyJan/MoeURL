package shortlink

import (
	"net/http/httptest"
	"testing"
)

// TestAnalyticsEventFieldsNormalizesAnonymousDimensions verifies only normalized dimensions are collected.
func TestAnalyticsEventFieldsNormalizesAnonymousDimensions(t *testing.T) {
	request := httptest.NewRequest("GET", "https://moe.example/abc123", nil)
	request.Header.Set("Referer", "https://Search.Example/path?private=value")
	request.Header.Set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")
	request.Header.Set("CF-IPCountry", "cn")

	referrer, device, country := analyticsEventFields(request, "CF-IPCountry")

	if referrer != "search.example" || device != "mobile" || country != "CN" {
		t.Fatalf("unexpected analytics dimensions: %q, %q, %q", referrer, device, country)
	}
}

// TestAnalyticsEventFieldsRejectsInvalidValues verifies malformed request metadata is not persisted.
func TestAnalyticsEventFieldsRejectsInvalidValues(t *testing.T) {
	request := httptest.NewRequest("GET", "https://moe.example/abc123", nil)
	request.Header.Set("Referer", "javascript:alert(1)")
	request.Header.Set("User-Agent", "unknown")
	request.Header.Set("CF-IPCountry", "China")

	referrer, device, country := analyticsEventFields(request, "CF-IPCountry")

	if referrer != "" || device != "other" || country != "" {
		t.Fatalf("unexpected invalid analytics dimensions: %q, %q, %q", referrer, device, country)
	}
}

// TestDeviceTypeClassifiesKnownClasses verifies bot, tablet, mobile, desktop, and unknown agents have stable buckets.
func TestDeviceTypeClassifiesKnownClasses(t *testing.T) {
	tests := []struct {
		name      string
		userAgent string
		want      string
	}{
		{name: "bot", userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", want: "bot"},
		{name: "tablet", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", want: "tablet"},
		{name: "mobile", userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36", want: "mobile"},
		{name: "desktop", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36", want: "desktop"},
		{name: "other", userAgent: "", want: "other"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := deviceType(test.userAgent); got != test.want {
				t.Fatalf("device type = %q, want %q", got, test.want)
			}
		})
	}
}
