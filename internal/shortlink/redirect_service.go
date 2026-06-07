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

type RedirectResult struct {
	TargetURL string
}

type RedirectService struct {
	queries  *sqlc.Queries
	recorder event.Recorder
}

func NewRedirectService(pool *pgxpool.Pool, recorder event.Recorder) *RedirectService {
	if recorder == nil {
		recorder = event.NoopRecorder{}
	}
	return &RedirectService{
		queries:  sqlc.New(pool),
		recorder: recorder,
	}
}

func (s *RedirectService) Resolve(ctx context.Context, slug string) (RedirectResult, error) {
	slug = strings.ToLower(slug)
	link, err := s.queries.GetShortLinkBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		s.record(ctx, event.AccessConditionChecked, slug)
		s.record(ctx, event.RedirectBlocked, slug)
		return RedirectResult{}, ErrShortLinkMissing
	}
	if err != nil {
		return RedirectResult{}, err
	}

	s.record(ctx, event.ShortLinkOpened, slug)
	s.record(ctx, event.AccessConditionChecked, slug)

	if link.Status != shortLinkStatusActive {
		s.record(ctx, event.RedirectBlocked, slug)
		return RedirectResult{}, ErrShortLinkDisabled
	}

	s.record(ctx, event.RedirectInitiated, slug)
	s.record(ctx, event.RedirectResponseSent, slug)
	return RedirectResult{TargetURL: link.TargetUrl}, nil
}

func (s *RedirectService) record(ctx context.Context, eventType string, slug string) {
	_ = s.recorder.Record(ctx, event.Event{Type: eventType, Slug: slug})
}
