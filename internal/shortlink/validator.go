package shortlink

import "net/url"

func validateTargetURL(value string) error {
	parsed, err := url.ParseRequestURI(value)
	if err != nil {
		return ErrInvalidTargetURL
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ErrInvalidTargetURL
	}
	if parsed.Host == "" {
		return ErrInvalidTargetURL
	}
	return nil
}
