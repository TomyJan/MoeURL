package oidc

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

// TestNormalizeProviderInput verifies stable identifiers, Unicode bounds, URLs, and IDNA domains.
func TestNormalizeProviderInput(t *testing.T) {
	input := providerInput{
		Key:                 " company-sso ",
		DisplayName:         " 企业登录 ",
		IssuerURL:           " https://id.example.com/realms/moeurl ",
		ClientID:            " moeurl-client ",
		AllowedEmailDomains: []string{" Example.COM. ", "例子.测试"},
	}

	normalized, err := normalizeProviderInput(input, false)
	if err != nil {
		t.Fatalf("normalize provider: %v", err)
	}
	if normalized.Key != "company-sso" || normalized.DisplayName != "企业登录" || normalized.ClientID != "moeurl-client" {
		t.Fatalf("normalized provider = %#v", normalized)
	}
	if normalized.IssuerURL != "https://id.example.com/realms/moeurl" {
		t.Fatalf("issuer URL = %q", normalized.IssuerURL)
	}
	wantDomains := []string{"example.com", "xn--fsqu00a.xn--0zwm56d"}
	if !reflect.DeepEqual(normalized.AllowedEmailDomains, wantDomains) {
		t.Fatalf("domains = %#v, want %#v", normalized.AllowedEmailDomains, wantDomains)
	}
}

// TestNormalizeProviderInputRejectsInvalidValues verifies invalid management input closes before discovery.
func TestNormalizeProviderInputRejectsInvalidValues(t *testing.T) {
	valid := providerInput{
		Key:                 "company",
		DisplayName:         "Company",
		IssuerURL:           "https://id.example.com",
		ClientID:            "moeurl",
		AllowedEmailDomains: []string{"example.com"},
	}
	tests := []struct {
		name          string
		mutate        func(*providerInput)
		allowLoopback bool
	}{
		{name: "uppercase key", mutate: func(value *providerInput) { value.Key = "Company" }},
		{name: "leading hyphen", mutate: func(value *providerInput) { value.Key = "-company" }},
		{name: "long key", mutate: func(value *providerInput) { value.Key = strings.Repeat("a", 65) }},
		{name: "empty display name", mutate: func(value *providerInput) { value.DisplayName = "  " }},
		{name: "long display name", mutate: func(value *providerInput) { value.DisplayName = strings.Repeat("界", 101) }},
		{name: "long client ID", mutate: func(value *providerInput) { value.ClientID = strings.Repeat("a", 513) }},
		{name: "issuer query", mutate: func(value *providerInput) { value.IssuerURL += "?tenant=a" }},
		{name: "issuer fragment", mutate: func(value *providerInput) { value.IssuerURL += "#fragment" }},
		{name: "issuer userinfo", mutate: func(value *providerInput) { value.IssuerURL = "https://user@id.example.com" }},
		{name: "production HTTP", mutate: func(value *providerInput) { value.IssuerURL = "http://127.0.0.1:8080" }},
		{name: "development remote HTTP", allowLoopback: true, mutate: func(value *providerInput) { value.IssuerURL = "http://id.example.com" }},
		{name: "empty domains", mutate: func(value *providerInput) { value.AllowedEmailDomains = nil }},
		{name: "duplicate domains", mutate: func(value *providerInput) { value.AllowedEmailDomains = []string{"example.com", "EXAMPLE.COM"} }},
		{name: "wildcard domain", mutate: func(value *providerInput) { value.AllowedEmailDomains = []string{"*.example.com"} }},
		{name: "email instead of domain", mutate: func(value *providerInput) { value.AllowedEmailDomains = []string{"user@example.com"} }},
		{name: "too many domains", mutate: func(value *providerInput) {
			value.AllowedEmailDomains = make([]string, 101)
			for index := range value.AllowedEmailDomains {
				value.AllowedEmailDomains[index] = "domain" + string(rune('a'+index%26)) + ".example"
			}
		}},
		{name: "invalid domain label", mutate: func(value *providerInput) { value.AllowedEmailDomains = []string{"bad_label.example"} }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := valid
			input.AllowedEmailDomains = append([]string(nil), valid.AllowedEmailDomains...)
			test.mutate(&input)
			if _, err := normalizeProviderInput(input, test.allowLoopback); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("normalize error = %v", err)
			}
		})
	}
}

// TestNormalizeProviderInputAllowsDevelopmentLoopbackIssuer verifies local IdP testing remains possible.
func TestNormalizeProviderInputAllowsDevelopmentLoopbackIssuer(t *testing.T) {
	for _, issuer := range []string{"http://127.0.0.1:18090", "http://[::1]:18090", "http://localhost:18090"} {
		input := providerInput{
			Key:                 "local",
			DisplayName:         "Local IdP",
			IssuerURL:           issuer,
			ClientID:            "moeurl",
			AllowedEmailDomains: []string{"example.test"},
		}
		if _, err := normalizeProviderInput(input, true); err != nil {
			t.Fatalf("normalize development provider %q: %v", issuer, err)
		}
	}
}
