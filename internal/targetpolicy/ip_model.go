package targetpolicy

import (
	"context"

	"github.com/TomyJan/MoeURL/internal/auth"
)

const IPKey = "security.target_ip_denylist"
const CodeIPInvalidInput = 900220
const CodeIPConflict = 900221

// IPSettings describes exact literal addresses, independently of all DNS rules.
type IPSettings struct {
	Addresses []string `json:"addresses"`
	UpdatedAt string   `json:"updatedAt"`
}

// IPUpdateInput replaces the complete address list against its exact revision.
type IPUpdateInput struct {
	Addresses         []string
	ExpectedUpdatedAt string
}

// IPPort exposes only current-authorized management operations.
type IPPort interface {
	Get(context.Context, auth.CurrentUser) (IPSettings, error)
	Update(context.Context, auth.CurrentUser, IPUpdateInput) (IPSettings, error)
}
