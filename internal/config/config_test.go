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

// TestLoadReadsSetupToken verifies the deployment-only setup credential is loaded.
func TestLoadReadsSetupToken(t *testing.T) {
	t.Setenv("MOEURL_SETUP_TOKEN", "setup-token")

	config := Load()

	if config.SetupToken != "setup-token" {
		t.Fatalf("setup token was not loaded")
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
		SetupToken:             " setup-token-with-more-than-32-characters ",
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
	if config.SetupToken != "setup-token-with-more-than-32-characters" {
		t.Fatal("setup token was not normalized")
	}
}

// TestConfigValidateSetupTokenByEnvironment verifies production-only setup token boundaries.
func TestConfigValidateSetupTokenByEnvironment(t *testing.T) {
	tests := []struct {
		name    string
		env     string
		token   string
		wantErr bool
	}{
		{name: "development omitted", env: "development"},
		{name: "production omitted", env: "production", wantErr: true},
		{name: "production whitespace", env: "production", token: "   ", wantErr: true},
		{name: "production 31 characters", env: "production", token: strings.Repeat("a", 31), wantErr: true},
		{name: "production 32 characters", env: "production", token: strings.Repeat("a", 32)},
		{name: "production 31 Unicode characters", env: "production", token: strings.Repeat("界", 31), wantErr: true},
		{name: "production 32 Unicode characters", env: "production", token: strings.Repeat("界", 32)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			config := Config{
				Env:         test.env,
				HTTPAddr:    ":8080",
				DatabaseURL: "postgres://localhost/moeurl",
				StaticDir:   "web/dist",
				SetupToken:  test.token,
			}

			err := config.Validate()
			if test.wantErr && err == nil {
				t.Fatal("expected setup token validation error")
			}
			if !test.wantErr && err != nil {
				t.Fatalf("validate config: %v", err)
			}
			if err != nil && test.token != "" && strings.Contains(err.Error(), test.token) {
				t.Fatal("validation error exposed the setup token")
			}
		})
	}
}

// TestConfigValidateRequiresHTTPAddress verifies an empty normalized listen address is rejected.
func TestConfigValidateRequiresHTTPAddress(t *testing.T) {
	config := Config{
		Env:         "development",
		HTTPAddr:    "   ",
		DatabaseURL: "postgres://localhost/moeurl",
		StaticDir:   "web/dist",
	}

	err := config.Validate()
	if err == nil || err.Error() != "MOEURL_HTTP_ADDR is required" {
		t.Fatalf("validate HTTP address error = %v", err)
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
				SetupToken:             strings.Repeat("a", 32),
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
