package shortlink

import (
	"net/netip"
	"testing"
)

func TestValidateTargetURLAcceptsPublicHTTPURLs(t *testing.T) {
	if err := validateTargetURL("https://example.com/path?q=1"); err != nil {
		t.Fatalf("expected public URL to pass, got %v", err)
	}
}

func TestValidateTargetURLRejectsInvalidAndUnsafeURLs(t *testing.T) {
	tests := []string{
		"://broken",
		"javascript:alert(1)",
		"https:///missing-host",
		"http://localhost/admin",
		"http://127.0.0.1/admin",
	}

	for _, targetURL := range tests {
		t.Run(targetURL, func(t *testing.T) {
			if err := validateTargetURL(targetURL); err == nil {
				t.Fatal("expected invalid target URL")
			}
		})
	}
}

func TestIsBlockedTargetIPCoversPrivateAndExplicitPrefixes(t *testing.T) {
	tests := []struct {
		name    string
		address string
		blocked bool
	}{
		{name: "public", address: "93.184.216.34", blocked: false},
		{name: "loopback", address: "127.0.0.1", blocked: true},
		{name: "private", address: "10.0.0.1", blocked: true},
		{name: "link local multicast", address: "ff02::1", blocked: true},
		{name: "unspecified", address: "0.0.0.0", blocked: true},
		{name: "carrier grade nat", address: "100.64.0.1", blocked: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ip := netip.MustParseAddr(tt.address)
			if got := isBlockedTargetIP(ip); got != tt.blocked {
				t.Fatalf("expected blocked=%v, got %v", tt.blocked, got)
			}
		})
	}
}
