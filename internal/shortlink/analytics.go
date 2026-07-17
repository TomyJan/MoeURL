package shortlink

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/mileusna/useragent"
)

// analyticsEventFields returns the anonymous dimensions allowed for visit aggregation.
func analyticsEventFields(request *http.Request, countryHeader string) (string, string, string) {
	return referrerHost(request.Referer()), deviceType(request.UserAgent()), countryCode(request.Header.Get(countryHeader))
}

// referrerHost extracts a normalized host from an HTTP(S) referer.
func referrerHost(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return strings.ToLower(parsed.Hostname())
}

// deviceType classifies a user agent without retaining the original header.
func deviceType(raw string) string {
	parsed := useragent.Parse(raw)
	switch {
	case parsed.Bot:
		return "bot"
	case parsed.Tablet:
		return "tablet"
	case parsed.Mobile:
		return "mobile"
	case parsed.Desktop:
		return "desktop"
	default:
		return "other"
	}
}

// countryCode returns a normalized two-letter country code or an empty value.
func countryCode(raw string) string {
	value := strings.ToUpper(strings.TrimSpace(raw))
	if len(value) != 2 || value[0] < 'A' || value[0] > 'Z' || value[1] < 'A' || value[1] > 'Z' {
		return ""
	}
	return value
}
