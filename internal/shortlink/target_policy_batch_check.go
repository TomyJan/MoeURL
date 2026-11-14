package shortlink

import (
	"context"
	"errors"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/jackc/pgx/v5"
)

const CodeTargetPolicyBatchCheckInvalidInput = 900227

var ErrTargetPolicyBatchCheckInvalidInput = errors.New("invalid batch target policy check input")

// TargetPolicyBatchCheckInput preserves each bounded original and its position.
type TargetPolicyBatchCheckInput struct{ TargetURLs []string }

// TargetPolicyBatchCheckItem discloses a position and decision, never a URL.
type TargetPolicyBatchCheckItem struct {
	Index   int    `json:"index"`
	Outcome string `json:"outcome"`
}

// TargetPolicyBatchCheckResult is an ordered, all-or-nothing result set.
type TargetPolicyBatchCheckResult struct {
	Items []TargetPolicyBatchCheckItem `json:"items"`
}

// TargetPolicyBatchCheckPort leaves the existing single-target and write ports unchanged.
type TargetPolicyBatchCheckPort interface {
	BatchCheckTargetPolicy(context.Context, auth.CurrentUser, TargetPolicyBatchCheckInput) (TargetPolicyBatchCheckResult, error)
}

// validPolicyBatchCheckInput enforces bounds before opening a transaction.
func validPolicyBatchCheckInput(targets []string) bool {
	if len(targets) < 1 || len(targets) > 20 {
		return false
	}
	for _, target := range targets {
		if !validPolicyCheckInput(target) {
			return false
		}
	}
	return true
}

// BatchCheckTargetPolicy authorizes once under the gate and uses one saved-rule
// snapshot for every basic-valid target; infrastructure failures discard all items.
func (s *Service) BatchCheckTargetPolicy(ctx context.Context, actor auth.CurrentUser, input TargetPolicyBatchCheckInput) (TargetPolicyBatchCheckResult, error) {
	if !validPolicyBatchCheckInput(input.TargetURLs) {
		return TargetPolicyBatchCheckResult{}, ErrTargetPolicyBatchCheckInvalidInput
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result TargetPolicyBatchCheckResult
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		if err := targetpolicy.LockTargets(ctx, tx); err != nil {
			return err
		}
		q := s.queries.WithTx(tx)
		if err := targetpolicy.AuthorizeAdminCheck(ctx, q, actor); err != nil {
			return err
		}
		result.Items = make([]TargetPolicyBatchCheckItem, len(input.TargetURLs))
		valid := make([]string, 0, len(input.TargetURLs))
		positions := make([]int, 0, len(input.TargetURLs))
		for i, target := range input.TargetURLs {
			result.Items[i] = TargetPolicyBatchCheckItem{Index: i + 1, Outcome: "invalid_target"}
			if err := validateTargetURL(target); err != nil {
				continue
			}
			valid = append(valid, target)
			positions = append(positions, i)
		}
		if len(valid) == 0 {
			return nil
		}
		decisions, err := targetpolicy.CheckTargetsIndividually(ctx, q, valid)
		if err != nil {
			return err
		}
		for i, decision := range decisions {
			outcome := "allowed"
			switch {
			case decision == nil:
			case errors.Is(decision, targetpolicy.ErrInvalidTarget):
				outcome = "invalid_target"
			case errors.Is(decision, targetpolicy.ErrTargetDenied):
				outcome = "restricted"
			default:
				return decision
			}
			result.Items[positions[i]].Outcome = outcome
		}
		return nil
	})
	if err != nil {
		return TargetPolicyBatchCheckResult{}, err
	}
	return result, nil
}
