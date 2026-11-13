// Package targetpolicy owns independent DNS-host and literal-IP write policies.
package targetpolicy

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
)

const Key = "security.target_host_denylist"
const CodeInvalidInput = 900210
const CodeConflict = 900211
const CodeTargetDenied = 200121

var (
	ErrInvalidInput     = errors.New("invalid target host policy")
	ErrConflict         = errors.New("target host policy conflict")
	ErrCorrupt          = errors.New("corrupt target host policy")
	ErrPermissionDenied = errors.New("target host policy permission denied")
	ErrTargetDenied     = errors.New("target host restricted")
	ErrInvalidTarget    = errors.New("invalid target host")
	versionPattern      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$`)
)

// Settings carries only the independent policy and complete-precision revision.
type Settings struct {
	Hosts     []string `json:"hosts"`
	UpdatedAt string   `json:"updatedAt"`
}

// UpdateInput is a full replacement against a caller's captured revision.
type UpdateInput struct {
	Hosts             []string
	ExpectedUpdatedAt string
}

// Port exposes no public policy endpoint or legacy general-setting fields.
type Port interface {
	Get(context.Context, auth.CurrentUser) (Settings, error)
	Update(context.Context, auth.CurrentUser, UpdateInput) (Settings, error)
}

// parseVersion rejects revisions whose written or UTC year cannot round-trip,
// as well as ambiguous, zero and submicrosecond timestamps.
func parseVersion(raw string) (time.Time, error) {
	if !versionPattern.MatchString(raw) {
		return time.Time{}, ErrInvalidInput
	}
	v, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil || v.Year() < 1 || v.Year() > 9999 || v.UTC().Year() < 1 || v.UTC().Year() > 9999 || v.IsZero() || v.Nanosecond()%1000 != 0 {
		return time.Time{}, ErrInvalidInput
	}
	return v, nil
}
