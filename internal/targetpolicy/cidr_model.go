package targetpolicy

import (
	"context"

	"github.com/TomyJan/MoeURL/internal/auth"
)

const CIDRKey = "security.target_cidr_denylist"
const CodeCIDRInvalidInput = 900222
const CodeCIDRConflict = 900223

// CIDRSettings describes literal IP networks, independently of all DNS rules.
type CIDRSettings struct {
	Prefixes  []string `json:"prefixes"`
	UpdatedAt string   `json:"updatedAt"`
}

// CIDRUpdateInput replaces the complete prefix list against its exact revision.
type CIDRUpdateInput struct {
	Prefixes          []string
	ExpectedUpdatedAt string
}

// CIDRPort exposes only current-authorized management operations.
type CIDRPort interface {
	Get(context.Context, auth.CurrentUser) (CIDRSettings, error)
	Update(context.Context, auth.CurrentUser, CIDRUpdateInput) (CIDRSettings, error)
}
