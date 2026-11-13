package targetpolicy

import (
	"context"
	"slices"
	"strings"

	"github.com/TomyJan/MoeURL/internal/auth"
)

const SuffixAllowlistKey = "security.target_host_suffix_allowlist"
const CodeSuffixAllowlistInvalidInput = 900218
const CodeSuffixAllowlistConflict = 900219

// SuffixAllowlistSettings is independent of the legacy denylist and general settings.
type SuffixAllowlistSettings struct {
	Enabled   bool     `json:"enabled"`
	Suffixes  []string `json:"suffixes"`
	UpdatedAt string   `json:"updatedAt"`
}

// SuffixAllowlistUpdateInput replaces both policy fields against one full revision.
type SuffixAllowlistUpdateInput struct {
	Enabled           bool
	Suffixes          []string
	ExpectedUpdatedAt string
}

// SuffixAllowlistPort exposes only the separately authorized management resource.
type SuffixAllowlistPort interface {
	Get(context.Context, auth.CurrentUser) (SuffixAllowlistSettings, error)
	Update(context.Context, auth.CurrentUser, SuffixAllowlistUpdateInput) (SuffixAllowlistSettings, error)
}

// checkAllowlistTargets accepts the union of enabled DNS allow rules. A disabled
// suffix resource delegates to the legacy exact rule, including its off behavior.
func checkAllowlistTargets(exact AllowlistSettings, suffix SuffixAllowlistSettings, targets []string) error {
	if !suffix.Enabled {
		return checkAllowlistHosts(exact, targets)
	}
	for _, target := range targets {
		host, err := targetHost(target)
		if err != nil {
			return err
		}
		if exact.Enabled {
			if _, found := slices.BinarySearch(exact.Hosts, host); found {
				continue
			}
		}
		allowed := false
		for _, rule := range suffix.Suffixes {
			if host == rule || strings.HasSuffix(host, "."+rule) {
				allowed = true
				break
			}
		}
		if !allowed {
			return ErrTargetDenied
		}
	}
	return nil
}
