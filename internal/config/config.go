package config

import (
	"encoding/base64"
	"errors"
	"net"
	"net/url"
	"os"
	"strings"

	"github.com/TomyJan/MoeURL/internal/setuptoken"
)

type Config struct {
	Env                    string
	HTTPAddr               string
	DatabaseURL            string
	StaticDir              string
	AnalyticsCountryHeader string
	SetupToken             string
	PublicBaseURL          string
	OIDCEncryptionKey      string
}

// Load reads the application configuration from environment variables.
func Load() Config {
	return Config{
		Env:                    os.Getenv("MOEURL_ENV"),
		HTTPAddr:               getEnv("MOEURL_HTTP_ADDR", ":8080"),
		DatabaseURL:            os.Getenv("MOEURL_DATABASE_URL"),
		StaticDir:              os.Getenv("MOEURL_STATIC_DIR"),
		AnalyticsCountryHeader: os.Getenv("MOEURL_ANALYTICS_COUNTRY_HEADER"),
		SetupToken:             os.Getenv("MOEURL_SETUP_TOKEN"),
		PublicBaseURL:          os.Getenv("MOEURL_PUBLIC_BASE_URL"),
		OIDCEncryptionKey:      os.Getenv("MOEURL_OIDC_ENCRYPTION_KEY"),
	}
}

// Normalize trims surrounding whitespace from configuration values.
func (c *Config) Normalize() {
	c.Env = strings.TrimSpace(c.Env)
	c.HTTPAddr = strings.TrimSpace(c.HTTPAddr)
	c.DatabaseURL = strings.TrimSpace(c.DatabaseURL)
	c.StaticDir = strings.TrimSpace(c.StaticDir)
	c.AnalyticsCountryHeader = strings.TrimSpace(c.AnalyticsCountryHeader)
	c.SetupToken = strings.TrimSpace(c.SetupToken)
	c.PublicBaseURL = strings.TrimSpace(c.PublicBaseURL)
	c.OIDCEncryptionKey = strings.TrimSpace(c.OIDCEncryptionKey)
}

// Validate normalizes and verifies that required configuration values are present.
func (c *Config) Validate() error {
	c.Normalize()
	if c.Env != "development" && c.Env != "production" {
		return errors.New("MOEURL_ENV must be development or production")
	}
	if c.HTTPAddr == "" {
		return errors.New("MOEURL_HTTP_ADDR is required")
	}
	if c.DatabaseURL == "" {
		return errors.New("MOEURL_DATABASE_URL is required")
	}
	if c.StaticDir == "" {
		return errors.New("MOEURL_STATIC_DIR is required")
	}
	if c.Env == "production" && !setuptoken.HasMinimumCharacters(c.SetupToken) {
		return errors.New("MOEURL_SETUP_TOKEN must contain at least 32 characters in production")
	}
	if err := c.validateOIDCConfiguration(); err != nil {
		return err
	}
	return nil
}

// validateOIDCConfiguration verifies the paired encryption key and trusted callback origin.
func (c *Config) validateOIDCConfiguration() error {
	hasBaseURL := c.PublicBaseURL != ""
	hasEncryptionKey := c.OIDCEncryptionKey != ""
	if hasBaseURL != hasEncryptionKey {
		return errors.New("MOEURL_PUBLIC_BASE_URL and MOEURL_OIDC_ENCRYPTION_KEY must be configured together")
	}
	if !hasBaseURL {
		return nil
	}

	key, err := base64.StdEncoding.DecodeString(c.OIDCEncryptionKey)
	if err != nil {
		return errors.New("MOEURL_OIDC_ENCRYPTION_KEY must be valid Base64")
	}
	if len(key) != 32 {
		return errors.New("MOEURL_OIDC_ENCRYPTION_KEY must decode to exactly 32 bytes")
	}

	baseURL, err := url.Parse(c.PublicBaseURL)
	if err != nil || !baseURL.IsAbs() || baseURL.Host == "" {
		return errors.New("MOEURL_PUBLIC_BASE_URL must be an absolute URL")
	}
	if baseURL.User != nil {
		return errors.New("MOEURL_PUBLIC_BASE_URL must not contain userinfo")
	}
	if baseURL.RawQuery != "" {
		return errors.New("MOEURL_PUBLIC_BASE_URL must not contain a query")
	}
	if baseURL.Fragment != "" {
		return errors.New("MOEURL_PUBLIC_BASE_URL must not contain a fragment")
	}
	if baseURL.Path != "" && baseURL.Path != "/" {
		return errors.New("MOEURL_PUBLIC_BASE_URL must use the root path")
	}
	if baseURL.Scheme != "https" {
		if c.Env != "development" || baseURL.Scheme != "http" || !isLoopbackHost(baseURL.Hostname()) {
			if c.Env == "development" && baseURL.Scheme == "http" {
				return errors.New("development HTTP MOEURL_PUBLIC_BASE_URL must use a loopback host")
			}
			return errors.New("MOEURL_PUBLIC_BASE_URL must use HTTPS")
		}
	}
	baseURL.Path = ""
	c.PublicBaseURL = baseURL.String()
	return nil
}

// isLoopbackHost reports whether a development callback host is local to this process.
func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// getEnv returns an environment value or its fallback when unset.
func getEnv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
