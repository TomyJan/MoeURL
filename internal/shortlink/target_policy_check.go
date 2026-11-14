package shortlink

import (
	"context"
	"errors"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/jackc/pgx/v5"
)

const CodeTargetPolicyCheckInvalidInput = 900226

var ErrTargetPolicyCheckInvalidInput = errors.New("invalid target policy check input")

// TargetPolicyCheckInput holds the original bounded URL, without rewriting it.
type TargetPolicyCheckInput struct {
	TargetURL string
}

// TargetPolicyCheckResult discloses only the decision at the check's instant.
type TargetPolicyCheckResult struct {
	Outcome string `json:"outcome"`
}

// TargetPolicyCheckPort keeps this action independent of existing link writes.
type TargetPolicyCheckPort interface {
	CheckTargetPolicy(context.Context, auth.CurrentUser, TargetPolicyCheckInput) (TargetPolicyCheckResult, error)
}

// validPolicyCheckInput imposes only this endpoint's byte and control bounds.
func validPolicyCheckInput(value string) bool {
	if len(value) == 0 || len(value) > 2048 || !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// CheckTargetPolicy reads saved rules under the shared gate, without creating
// links, audit records, quota reservations or network requests.
func (s *Service) CheckTargetPolicy(ctx context.Context, actor auth.CurrentUser, input TargetPolicyCheckInput) (TargetPolicyCheckResult, error) {
	if !validPolicyCheckInput(input.TargetURL) {
		return TargetPolicyCheckResult{}, ErrTargetPolicyCheckInvalidInput
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result TargetPolicyCheckResult
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		if err := targetpolicy.LockTargets(ctx, tx); err != nil {
			return err
		}
		q := s.queries.WithTx(tx)
		if err := targetpolicy.AuthorizeAdminCheck(ctx, q, actor); err != nil {
			return err
		}
		if err := validateTargetURL(input.TargetURL); err != nil {
			result.Outcome = "invalid_target"
			return nil
		}
		err := targetpolicy.CheckTargets(ctx, q, []string{input.TargetURL})
		switch {
		case err == nil:
			result.Outcome = "allowed"
		case errors.Is(err, targetpolicy.ErrInvalidTarget):
			result.Outcome = "invalid_target"
		case errors.Is(err, targetpolicy.ErrTargetDenied):
			result.Outcome = "restricted"
		default:
			return err
		}
		return nil
	})
	if err != nil {
		return TargetPolicyCheckResult{}, err
	}
	return result, nil
}
