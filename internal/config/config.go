package config

import "os"

type Config struct {
	Env         string
	HTTPAddr    string
	DatabaseURL string
	StaticDir   string
}

func Load() Config {
	return Config{
		Env:         getEnv("MOEURL_ENV", "development"),
		HTTPAddr:    getEnv("MOEURL_HTTP_ADDR", ":8080"),
		DatabaseURL: os.Getenv("MOEURL_DATABASE_URL"),
		StaticDir:   os.Getenv("MOEURL_STATIC_DIR"),
	}
}

func getEnv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
