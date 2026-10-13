package shortlink

import (
	"context"
	"errors"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
)

const visitClaimTimeout = 5 * time.Second

// visitTransactionStore provides the transaction boundary for quota claims.
type visitTransactionStore interface {
	Begin(context.Context) (pgx.Tx, error)
}

// claimLimitedVisit rechecks access under row locks and reserves one final redirect.
// Quota is never refunded: once committed, the redirect may have reached the client.
func (s *RedirectService) claimLimitedVisit(ctx context.Context, slug, accessToken, requestHost string, continuing bool) (OpenResult, error) {
	ctx, cancel := context.WithTimeout(ctx, visitClaimTimeout)
	defer cancel()
	tx, err := s.visitTransactions.Begin(ctx)
	if err != nil {
		return OpenResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	queries := sqlc.New(tx)
	if _, err := queries.GetShortLinkBySlugForVisitClaim(ctx, slug); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return OpenResult{}, ErrShortLinkMissing
		}
		return OpenResult{}, err
	}
	// LockRows may wait after evaluating SELECT expressions. Read again after locking
	// so expiration and every access setting use the state at the time of the claim.
	link, err := queries.GetShortLinkBySlug(ctx, slug)
	if err != nil {
		return OpenResult{}, err
	}
	if !publicDomainMatches(link.DomainHost, link.DomainEnabled, link.DomainPurpose, requestHost) {
		return OpenResult{}, ErrShortLinkMissing
	}
	if err := s.checkAccess(ctx, slug, uuidFromPgtype(link.ID), link.Status, link.Expired, link.RedirectMode, false); err != nil {
		return OpenResult{}, err
	}
	if link.Exhausted {
		return OpenResult{}, ErrShortLinkExhausted
	}
	result := OpenResult{
		RedirectResult: RedirectResult{ShortLinkID: uuidFromPgtype(link.ID)},
		RedirectMode:   link.RedirectMode, Slug: slug, RequiresPassword: link.PasswordHash.Valid,
	}
	if !continuing && (result.RequiresPassword || isInteractiveRedirectMode(link.RedirectMode)) {
		return result, nil
	}
	if continuing {
		if !result.RequiresPassword && !isInteractiveRedirectMode(link.RedirectMode) {
			return OpenResult{}, ErrShortLinkNotInteractive
		}
		if result.RequiresPassword {
			valid, err := hasValidAccessGrantWithQueries(ctx, queries, link.ID, accessToken)
			if err != nil {
				return OpenResult{}, err
			}
			if !valid {
				return OpenResult{}, ErrPasswordRequired
			}
		}
	}
	if link.MaxVisits.Valid {
		if _, err := queries.ClaimShortLinkVisit(ctx, link.ID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return OpenResult{}, ErrShortLinkExhausted
			}
			return OpenResult{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return OpenResult{}, err
	}
	result.TargetURL = link.TargetUrl
	return result, nil
}
