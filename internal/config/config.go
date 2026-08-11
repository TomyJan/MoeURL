package config

import (
	"errors"
	"os"
	"strings"
)

type Config struct {
	Env                    string
	HTTPAddr               string
	DatabaseURL            string
	StaticDir              string
	AnalyticsCountryHeader string
}

// Load reads the application configuration from environment variables.
func Load() Config {
	return Config{
		Env:                    os.Getenv("MOEURL_ENV"),
		HTTPAddr:               getEnv("MOEURL_HTTP_ADDR", ":8080"),
		DatabaseURL:            os.Getenv("MOEURL_DATABASE_URL"),
		StaticDir:              os.Getenv("MOEURL_STATIC_DIR"),
		AnalyticsCountryHeader: os.Getenv("MOEURL_ANALYTICS_COUNTRY_HEADER"),
	}
}

// Validate verifies that required configuration values are present.
func (c *Config) Validate() error {
	c.Env = strings.TrimSpace(c.Env)
	c.DatabaseURL = strings.TrimSpace(c.DatabaseURL)
	c.StaticDir = strings.TrimSpace(c.StaticDir)
	if c.Env != "development" && c.Env != "production" {
		return errors.New("MOEURL_ENV must be development or production")
	}
	if c.DatabaseURL == "" {
		return errors.New("MOEURL_DATABASE_URL is required")
	}
	if c.StaticDir == "" {
		return errors.New("MOEURL_STATIC_DIR is required")
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
