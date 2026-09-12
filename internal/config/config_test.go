package config

import (
	"encoding/base64"
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

// TestLoadReadsOIDCConfiguration verifies external-login deployment values are loaded without transformation.
func TestLoadReadsOIDCConfiguration(t *testing.T) {
	t.Setenv("MOEURL_PUBLIC_BASE_URL", "https://links.example.com")
	t.Setenv("MOEURL_OIDC_ENCRYPTION_KEY", "encryption-key")

	config := Load()

	if config.PublicBaseURL != "https://links.example.com" {
		t.Fatalf("public base URL = %q", config.PublicBaseURL)
	}
	if config.OIDCEncryptionKey != "encryption-key" {
		t.Fatal("OIDC encryption key was not loaded")
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
		PublicBaseURL:          " https://links.example.com ",
		OIDCEncryptionKey:      " encryption-key ",
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
	if config.PublicBaseURL != "https://links.example.com" {
		t.Fatalf("public base URL = %q, want normalized value", config.PublicBaseURL)
	}
	if config.OIDCEncryptionKey != "encryption-key" {
		t.Fatal("OIDC encryption key was not normalized")
	}
}

// TestConfigValidateOIDCConfiguration verifies paired secrets and trusted callback URL boundaries.
func TestConfigValidateOIDCConfiguration(t *testing.T) {
	validKey := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	tests := []struct {
		name      string
		env       string
		baseURL   string
		key       string
		wantError string
	}{
		{name: "configuration omitted", env: "production"},
		{name: "production HTTPS", env: "production", baseURL: "https://links.example.com/", key: validKey},
		{name: "development HTTPS", env: "development", baseURL: "https://links.example.com", key: validKey},
		{name: "development IPv4 loopback HTTP", env: "development", baseURL: "http://127.0.0.1:8080", key: validKey},
		{name: "development localhost HTTP", env: "development", baseURL: "http://localhost:8080", key: validKey},
		{name: "development IPv6 loopback HTTP", env: "development", baseURL: "http://[::1]:8080", key: validKey},
		{name: "missing key", env: "production", baseURL: "https://links.example.com", wantError: "must be configured together"},
		{name: "missing URL", env: "production", key: validKey, wantError: "must be configured together"},
		{name: "invalid base64", env: "production", baseURL: "https://links.example.com", key: "not-base64", wantError: "valid Base64"},
		{name: "short key", env: "production", baseURL: "https://links.example.com", key: base64.StdEncoding.EncodeToString([]byte("short")), wantError: "exactly 32 bytes"},
		{name: "production HTTP", env: "production", baseURL: "http://links.example.com", key: validKey, wantError: "must use HTTPS"},
		{name: "development remote HTTP", env: "development", baseURL: "http://links.example.com", key: validKey, wantError: "loopback"},
		{name: "relative URL", env: "development", baseURL: "/moeurl", key: validKey, wantError: "absolute URL"},
		{name: "path", env: "production", baseURL: "https://links.example.com/moeurl", key: validKey, wantError: "root path"},
		{name: "query", env: "production", baseURL: "https://links.example.com?tenant=a", key: validKey, wantError: "query"},
		{name: "fragment", env: "production", baseURL: "https://links.example.com/#callback", key: validKey, wantError: "fragment"},
		{name: "userinfo", env: "production", baseURL: "https://user@links.example.com", key: validKey, wantError: "userinfo"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			config := Config{
				Env:               test.env,
				HTTPAddr:          ":8080",
				DatabaseURL:       "postgres://localhost/moeurl",
				StaticDir:         "web/dist",
				SetupToken:        strings.Repeat("a", 32),
				PublicBaseURL:     test.baseURL,
				OIDCEncryptionKey: test.key,
			}

			err := config.Validate()
			if test.wantError == "" && err != nil {
				t.Fatalf("validate config: %v", err)
			}
			if test.wantError != "" && (err == nil || !strings.Contains(err.Error(), test.wantError)) {
				t.Fatalf("validate error = %v, want substring %q", err, test.wantError)
			}
			if err != nil && test.key != "" && strings.Contains(err.Error(), test.key) {
				t.Fatal("validation error exposed the OIDC encryption key")
			}
			if err == nil && test.baseURL != "" && strings.HasSuffix(test.baseURL, "/") && strings.HasSuffix(config.PublicBaseURL, "/") {
				t.Fatalf("public base URL was not normalized: %q", config.PublicBaseURL)
			}
		})
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
