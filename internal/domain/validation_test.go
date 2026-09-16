package domain

import (
	"errors"
	"strings"
	"testing"
)

// TestNormalizeOrigin accepts only canonicalizable root Origins.
func TestNormalizeOrigin(t *testing.T) {
	for _, test := range []struct {
		name          string
		input         string
		allowLoopback bool
		want          string
		invalid       bool
	}{
		{name: "HTTPS", input: "https://GO.Example.com", want: "https://go.example.com"},
		{name: "root path", input: "https://go.example.com/", want: "https://go.example.com"},
		{name: "default HTTPS port", input: "https://go.example.com:443", want: "https://go.example.com"},
		{name: "nondefault HTTPS port", input: "https://go.example.com:8443", want: "https://go.example.com:8443"},
		{name: "Unicode hostname", input: "https://例子.测试", want: "https://xn--fsqu00a.xn--0zwm56d"},
		{name: "dev loopback", input: "http://localhost:8080", allowLoopback: true, want: "http://localhost:8080"},
		{name: "dev IPv6", input: "http://[::1]:8080", allowLoopback: true, want: "http://[::1]:8080"},
		{name: "IPv6 without port", input: "https://[::1]", want: "https://[::1]"},
		{name: "production HTTP loopback", input: "http://127.0.0.1:8080", invalid: true},
		{name: "nonloopback HTTP", input: "http://go.example.com", allowLoopback: true, invalid: true},
		{name: "bare host", input: "go.example.com", invalid: true},
		{name: "non-root path", input: "https://go.example.com/go", invalid: true},
		{name: "query", input: "https://go.example.com/?x=1", invalid: true},
		{name: "empty query", input: "https://go.example.com?", invalid: true},
		{name: "fragment", input: "https://go.example.com/#x", invalid: true},
		{name: "empty fragment", input: "https://go.example.com#", invalid: true},
		{name: "userinfo", input: "https://user@go.example.com", invalid: true},
		{name: "empty hostname", input: "https://:443", invalid: true},
		{name: "invalid port", input: "https://go.example.com:65536", invalid: true},
		{name: "invalid DNS label", input: "https://bad_label.example.com", invalid: true},
		{name: "oversized DNS label", input: "https://" + strings.Repeat("a", 64) + ".example.com", invalid: true},
		{name: "oversized hostname", input: "https://" + strings.Repeat("a", 63) + "." + strings.Repeat("b", 63) + "." + strings.Repeat("c", 63) + "." + strings.Repeat("d", 63), invalid: true},
		{name: "empty port", input: "https://go.example.com:", invalid: true},
		{name: "control character", input: "https://go.example.com\n", invalid: true},
		{name: "whitespace", input: " https://go.example.com", invalid: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeOrigin(test.input, test.allowLoopback)
			if test.invalid {
				if !errors.Is(err, ErrInvalidOrigin) {
					t.Fatalf("NormalizeOrigin(%q) error = %v, want ErrInvalidOrigin", test.input, err)
				}
				return
			}
			if err != nil || got != test.want {
				t.Fatalf("NormalizeOrigin(%q) = %q, %v; want %q", test.input, got, err, test.want)
			}
		})
	}
}

// TestAuthorityAndHostMatching preserves legacy bare hosts without trusting aliases.
func TestAuthorityAndHostMatching(t *testing.T) {
	for _, test := range []struct {
		stored string
		host   string
		want   bool
	}{
		{stored: "go.example.com", host: "GO.EXAMPLE.COM", want: true},
		{stored: "go.example.com", host: "go.example.com:443", want: true},
		{stored: "https://go.example.com:443", host: "go.example.com", want: true},
		{stored: "go.example.com:8443", host: "go.example.com:8443", want: true},
		{stored: "https://go.example.com:8443", host: "go.example.com:443"},
		{stored: "http://localhost:8080", host: "localhost:8080", want: true},
		{stored: "go.example.com", host: "other.example.com"},
		{stored: "go.example.com", host: "go.example.com.evil"},
		{stored: "go.example.com", host: "go.example.com@evil"},
		{stored: "bad host", host: "go.example.com"},
		{stored: "go.example.com", host: "https://go.example.com"},
	} {
		if got := MatchesHost(test.stored, test.host); got != test.want {
			t.Errorf("MatchesHost(%q, %q) = %t, want %t", test.stored, test.host, got, test.want)
		}
	}
	oldAuthority, err := Authority("go.example.com:443")
	if err != nil {
		t.Fatalf("legacy authority: %v", err)
	}
	newAuthority, err := Authority("https://GO.Example.com")
	if err != nil || oldAuthority != newAuthority {
		t.Fatalf("equivalent authorities = %q, %q, %v", oldAuthority, newAuthority, err)
	}
}
