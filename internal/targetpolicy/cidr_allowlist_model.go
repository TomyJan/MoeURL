package targetpolicy

import (
	"context"
	"net/netip"
	"net/url"

	"github.com/TomyJan/MoeURL/internal/auth"
)

const CIDRAllowlistKey = "security.target_cidr_allowlist"
const CodeCIDRAllowlistInvalidInput = 900224
const CodeCIDRAllowlistConflict = 900225

// CIDRAllowlistSettings is independent of the legacy denylist and general settings.
type CIDRAllowlistSettings struct {
	Enabled   bool     `json:"enabled"`
	Prefixes  []string `json:"prefixes"`
	UpdatedAt string   `json:"updatedAt"`
}

// CIDRAllowlistUpdateInput replaces both policy fields against one full revision.
type CIDRAllowlistUpdateInput struct {
	Enabled           bool
	Prefixes          []string
	ExpectedUpdatedAt string
}

// CIDRAllowlistPort exposes only the separately authorized management resource.
type CIDRAllowlistPort interface {
	Get(context.Context, auth.CurrentUser) (CIDRAllowlistSettings, error)
	Update(context.Context, auth.CurrentUser, CIDRAllowlistUpdateInput) (CIDRAllowlistSettings, error)
}

// checkCombinedAllowlistTargets preserves legacy semantics while CIDR is off.
// Enabled rules form a union within each literal-IP or DNS classification.
func checkCombinedAllowlistTargets(exact AllowlistSettings, suffix SuffixAllowlistSettings, cidr CIDRAllowlistSettings, targets []string) error {
	if !cidr.Enabled {
		return checkAllowlistTargets(exact, suffix, targets)
	}
	networks := make([]netip.Prefix, 0, len(cidr.Prefixes))
	for _, raw := range cidr.Prefixes {
		prefix, err := netip.ParsePrefix(raw)
		if err != nil || prefix.Addr().Is4In6() || prefix != prefix.Masked() {
			return ErrCorrupt
		}
		networks = append(networks, prefix)
	}
	for _, target := range targets {
		u, err := url.ParseRequestURI(target)
		if err != nil || u.Host == "" || u.Scheme != "http" && u.Scheme != "https" {
			return ErrInvalidTarget
		}
		address, err := netip.ParseAddr(u.Hostname())
		if err == nil {
			if address.Zone() != "" {
				return ErrInvalidTarget
			}
			allowed := false
			for _, network := range networks {
				if network.Contains(address.Unmap()) {
					allowed = true
					break
				}
			}
			if !allowed {
				return ErrTargetDenied
			}
			continue
		}
		if _, err := targetHost(target); err != nil {
			return err
		}
		if !exact.Enabled && !suffix.Enabled {
			return ErrTargetDenied
		}
		if err := checkAllowlistTargets(exact, suffix, []string{target}); err != nil {
			return err
		}
	}
	return nil
}
