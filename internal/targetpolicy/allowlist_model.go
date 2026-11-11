package targetpolicy

import (
	"context"

	"github.com/TomyJan/MoeURL/internal/auth"
)

const AllowlistKey = "security.target_host_allowlist"
const CodeAllowlistInvalidInput = 900212
const CodeAllowlistConflict = 900213

// AllowlistSettings is independent of the legacy denylist and general settings.
type AllowlistSettings struct {
	Enabled   bool     `json:"enabled"`
	Hosts     []string `json:"hosts"`
	UpdatedAt string   `json:"updatedAt"`
}

// AllowlistUpdateInput replaces both policy fields against one full revision.
type AllowlistUpdateInput struct {
	Enabled           bool
	Hosts             []string
	ExpectedUpdatedAt string
}

// AllowlistPort exposes only the separately authorized management resource.
type AllowlistPort interface {
	Get(context.Context, auth.CurrentUser) (AllowlistSettings, error)
	Update(context.Context, auth.CurrentUser, AllowlistUpdateInput) (AllowlistSettings, error)
}
