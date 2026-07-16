package shortlink

import (
	"context"
	"errors"
	"strings"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/event"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RedirectResult contains the resolved redirect target and source short link.
type RedirectResult struct {
	TargetURL   string
	ShortLinkID string
}

// RedirectService resolves short link redirects.
type RedirectService struct {
	queries  *sqlc.Queries
	recorder event.Recorder
}

// NewRedirectService creates a redirect service backed by PostgreSQL.
func NewRedirectService(pool *pgxpool.Pool, recorder event.Recorder) *RedirectService {
	if recorder == nil {
		recorder = event.NoopRecorder{}
	}
	return &RedirectService{
		queries:  sqlc.New(pool),
		recorder: recorder,
	}
}

// Resolve resolves a slug into a redirect target.
func (s *RedirectService) Resolve(ctx context.Context, slug string) (RedirectResult, error) {
	slug = strings.ToLower(slug)
	link, err := s.queries.GetShortLinkBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		s.record(ctx, event.AccessConditionChecked, slug, "")
		s.record(ctx, event.RedirectBlocked, slug, "")
		return RedirectResult{}, ErrShortLinkMissing
	}
	if err != nil {
		return RedirectResult{}, err
	}

	shortLinkID := uuidFromPgtype(link.ID)
	s.record(ctx, event.ShortLinkOpened, slug, shortLinkID)
	s.record(ctx, event.AccessConditionChecked, slug, shortLinkID)

	if link.Status != shortLinkStatusActive {
		s.record(ctx, event.RedirectBlocked, slug, shortLinkID)
		return RedirectResult{}, ErrShortLinkDisabled
	}

	s.record(ctx, event.RedirectInitiated, slug, shortLinkID)
	return RedirectResult{TargetURL: link.TargetUrl, ShortLinkID: shortLinkID}, nil
}

// record implements package-specific behavior.
func (s *RedirectService) record(ctx context.Context, eventType string, slug string, shortLinkID string) {
	_ = s.recorder.Record(ctx, event.Event{Type: eventType, Slug: slug, ShortLinkID: shortLinkID})
}
