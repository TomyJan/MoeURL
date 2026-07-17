package config

import (
	"errors"
	"os"
	"strings"
)

type Config struct {
	Env         string
	HTTPAddr    string
	DatabaseURL string
	StaticDir   string
}

// Load reads the application configuration from environment variables.
func Load() Config {
	return Config{
		Env:         getEnv("MOEURL_ENV", "development"),
		HTTPAddr:    getEnv("MOEURL_HTTP_ADDR", ":8080"),
		DatabaseURL: os.Getenv("MOEURL_DATABASE_URL"),
		StaticDir:   os.Getenv("MOEURL_STATIC_DIR"),
	}
}

// Validate verifies that required configuration values are present.
func (c Config) Validate() error {
	if strings.TrimSpace(c.DatabaseURL) == "" {
		return errors.New("MOEURL_DATABASE_URL is required")
	}
	if strings.TrimSpace(c.StaticDir) == "" {
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
