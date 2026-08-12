package config

import (
	"strings"
	"testing"
)

// TestLoadReadsAnalyticsCountryHeader verifies the optional country header configuration is loaded.
func TestLoadReadsAnalyticsCountryHeader(t *testing.T) {
	t.Setenv("MOEURL_ANALYTICS_COUNTRY_HEADER", "CF-IPCountry")

	config := Load()

	if config.AnalyticsCountryHeader != "CF-IPCountry" {
		t.Fatalf("analytics country header = %q", config.AnalyticsCountryHeader)
	}
}

// TestLoadPreservesEmptyEnvironmentForValidation verifies that Load does not hide an explicitly empty environment.
func TestLoadPreservesEmptyEnvironmentForValidation(t *testing.T) {
	t.Setenv("MOEURL_ENV", "")

	config := Load()

	if config.Env != "" {
		t.Fatalf("environment = %q, want empty value for validation", config.Env)
	}
}

// TestConfigNormalizeTrimsAllFields verifies configuration normalization is independent from validation.
func TestConfigNormalizeTrimsAllFields(t *testing.T) {
	config := Config{
		Env:                    " development ",
		HTTPAddr:               " :8080 ",
		DatabaseURL:            " postgres://localhost/moeurl ",
		StaticDir:              " web/dist ",
		AnalyticsCountryHeader: " CF-IPCountry ",
	}

	config.Normalize()

	if config.Env != "development" {
		t.Fatalf("environment = %q, want normalized value", config.Env)
	}
	if config.HTTPAddr != ":8080" {
		t.Fatalf("HTTP address = %q, want normalized value", config.HTTPAddr)
	}
	if config.DatabaseURL != "postgres://localhost/moeurl" {
		t.Fatalf("database URL = %q, want normalized value", config.DatabaseURL)
	}
	if config.StaticDir != "web/dist" {
		t.Fatalf("static dir = %q, want normalized value", config.StaticDir)
	}
	if config.AnalyticsCountryHeader != "CF-IPCountry" {
		t.Fatalf("analytics country header = %q, want normalized value", config.AnalyticsCountryHeader)
	}
}

// TestConfigValidateRequiresKnownEnvironment verifies that only supported deployment environments pass validation.
func TestConfigValidateRequiresKnownEnvironment(t *testing.T) {
	for _, test := range []struct {
		name    string
		env     string
		wantErr bool
	}{
		{name: "development", env: "development"},
		{name: "production", env: "production"},
		{name: "trimmed development", env: " development "},
		{name: "trimmed production", env: " production "},
		{name: "empty", env: "", wantErr: true},
		{name: "abbreviated production", env: "prod", wantErr: true},
		{name: "capitalized production", env: "Production", wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			config := Config{
				Env:                    test.env,
				HTTPAddr:               " :8080 ",
				DatabaseURL:            "  postgres://localhost/moeurl  ",
				StaticDir:              "  web/dist  ",
				AnalyticsCountryHeader: " CF-IPCountry ",
			}

			err := config.Validate()
			if test.wantErr && err == nil {
				t.Fatal("expected environment validation error")
			}
			if !test.wantErr && err != nil {
				t.Fatalf("validate environment: %v", err)
			}
			if !test.wantErr && config.Env != strings.TrimSpace(test.env) {
				t.Fatalf("environment = %q, want normalized value", config.Env)
			}
			if !test.wantErr && config.DatabaseURL != "postgres://localhost/moeurl" {
				t.Fatalf("database URL = %q, want normalized value", config.DatabaseURL)
			}
			if !test.wantErr && config.StaticDir != "web/dist" {
				t.Fatalf("static dir = %q, want normalized value", config.StaticDir)
			}
			if !test.wantErr && config.HTTPAddr != ":8080" {
				t.Fatalf("HTTP address = %q, want normalized value", config.HTTPAddr)
			}
			if !test.wantErr && config.AnalyticsCountryHeader != "CF-IPCountry" {
				t.Fatalf("analytics country header = %q, want normalized value", config.AnalyticsCountryHeader)
			}
		})
	}
}
