package config

import (
	"errors"
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
	return nil
}

// getEnv returns an environment value or its fallback when unset.
func getEnv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
