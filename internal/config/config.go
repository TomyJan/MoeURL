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

// Load implements package-specific behavior.
func Load() Config {
	return Config{
		Env:         getEnv("MOEURL_ENV", "development"),
		HTTPAddr:    getEnv("MOEURL_HTTP_ADDR", ":8080"),
		DatabaseURL: os.Getenv("MOEURL_DATABASE_URL"),
		StaticDir:   os.Getenv("MOEURL_STATIC_DIR"),
	}
}

// Validate implements package-specific behavior.
func (c Config) Validate() error {
	if strings.TrimSpace(c.DatabaseURL) == "" {
		return errors.New("MOEURL_DATABASE_URL is required")
	}
	if strings.TrimSpace(c.StaticDir) == "" {
		return errors.New("MOEURL_STATIC_DIR is required")
	}
	return nil
}

// getEnv implements package-specific behavior.
func getEnv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
