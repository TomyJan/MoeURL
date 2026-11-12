// Package createquota owns optional per-account UTC-day creation budgets.
package createquota

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
)

const Key = "security.account_daily_create_quota"
const CodeInvalidInput = 900214
const CodeConflict = 900215
const CodeExhausted = 200122
const maxDailyLimit int64 = 1000000

var (
	ErrInvalidInput     = errors.New("invalid daily create quota")
	ErrConflict         = errors.New("daily create quota conflict")
	ErrPermissionDenied = errors.New("daily create quota permission denied")
	ErrCorrupt          = errors.New("corrupt daily create quota")
	ErrExhausted        = errors.New("daily create quota exhausted")
	versionPattern      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$`)
)

// Settings is a separate resource; nil means unlimited, not zero usage.
type Settings struct {
	DailyLimit *int64 `json:"dailyLimit"`
	UpdatedAt  string `json:"updatedAt"`
}

// UpdateInput replaces the explicit nullable limit against one full revision.
type UpdateInput struct {
	DailyLimit        *int64
	ExpectedUpdatedAt string
}

// Port exposes only currently authorized management reads and replacements.
type Port interface {
	Get(context.Context, auth.CurrentUser) (Settings, error)
	Update(context.Context, auth.CurrentUser, UpdateInput) (Settings, error)
}

// parseVersion preserves microseconds and rejects unroundtrippable revisions.
func parseVersion(raw string) (time.Time, error) {
	if !versionPattern.MatchString(raw) {
		return time.Time{}, ErrInvalidInput
	}
	v, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil || v.IsZero() || v.Year() < 1 || v.Year() > 9999 || v.Nanosecond()%1000 != 0 {
		return time.Time{}, ErrInvalidInput
	}
	return v, nil
}

// validLimit applies equally while enabling and disabling the optional budget.
func validLimit(limit *int64) bool { return limit == nil || *limit >= 0 && *limit <= maxDailyLimit }
