package targetpolicy

import (
	"context"
	"strings"

	"github.com/TomyJan/MoeURL/internal/auth"
)

const SuffixKey = "security.target_host_suffix_denylist"
const CodeSuffixInvalidInput = 900216
const CodeSuffixConflict = 900217

// SuffixSettings owns complete DNS-label suffixes, independent of exact rules.
type SuffixSettings struct {
	Suffixes  []string `json:"suffixes"`
	UpdatedAt string   `json:"updatedAt"`
}

// SuffixUpdateInput is a complete replacement against the captured revision.
type SuffixUpdateInput struct {
	Suffixes          []string
	ExpectedUpdatedAt string
}

// SuffixPort exposes only separately authorized administrator operations.
type SuffixPort interface {
	Get(context.Context, auth.CurrentUser) (SuffixSettings, error)
	Update(context.Context, auth.CurrentUser, SuffixUpdateInput) (SuffixSettings, error)
}

// checkSuffixes preserves legacy syntax with an empty policy and checks whole
// label boundaries. IP classification returns no DNS host and never matches.
func checkSuffixes(suffixes, targets []string) error {
	if len(suffixes) == 0 {
		return nil
	}
	for _, target := range targets {
		host, err := targetHost(target)
		if err != nil {
			return err
		}
		for _, suffix := range suffixes {
			if host == suffix || strings.HasSuffix(host, "."+suffix) {
				return ErrTargetDenied
			}
		}
	}
	return nil
}
