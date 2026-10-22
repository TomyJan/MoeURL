package shortlink

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/mileusna/useragent"
)

// analyticsEventFields returns the anonymous dimensions allowed for visit aggregation.
func analyticsEventFields(request *http.Request, countryHeader string) (string, string, string, string, string) {
	device, browser, os := anonymousAgent(request.UserAgent())
	return referrerHost(request.Referer()), device, countryCode(request.Header.Get(countryHeader)), browser, os
}

// referrerHost extracts a normalized host from an HTTP(S) referer.
func referrerHost(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return strings.ToLower(parsed.Hostname())
}

// anonymousAgent parses a bounded UA once and retains only stable allowlisted categories.
func anonymousAgent(raw string) (string, string, string) {
	if len(raw) > 4096 {
		return "other", "", ""
	}
	parsed := useragent.Parse(raw)
	device := "other"
	switch {
	case parsed.Bot:
		device = "bot"
	case parsed.Tablet:
		device = "tablet"
	case parsed.Mobile:
		device = "mobile"
	case parsed.Desktop:
		device = "desktop"
	}
	browser := map[string]string{useragent.Chrome: "chrome", useragent.HeadlessChrome: "chrome", useragent.Edge: "edge", useragent.Firefox: "firefox", useragent.Safari: "safari", useragent.Opera: "opera", useragent.OperaMini: "opera", useragent.SamsungBrowser: "samsung"}[parsed.Name]
	if parsed.Bot {
		browser = "bot"
	} else if browser == "" && parsed.Name != "" && parsed.Version != "" {
		browser = "other"
	}
	os := map[string]string{useragent.Windows: "windows", useragent.MacOS: "macos", useragent.IOS: "ios", useragent.Android: "android", useragent.Linux: "linux", useragent.ChromeOS: "chromeos"}[parsed.OS]
	if os == "" && parsed.OS != "" {
		os = "other"
	}
	return device, browser, os
}

// countryCode returns a normalized two-letter country code or an empty value.
func countryCode(raw string) string {
	value := strings.ToUpper(strings.TrimSpace(raw))
	if len(value) != 2 || value[0] < 'A' || value[0] > 'Z' || value[1] < 'A' || value[1] > 'Z' {
		return ""
	}
	return value
}
