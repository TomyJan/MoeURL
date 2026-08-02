package shortlink

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

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

// OpenResult contains the decision for an initial public short-link request.
type OpenResult struct {
	RedirectResult
	RedirectMode string
	Slug         string
}

// PreviewResult contains the minimal public data required by an intermediate page.
type PreviewResult struct {
	Slug                     string     `json:"slug"`
	TargetHost               string     `json:"targetHost"`
	IntermediateDelaySeconds int16      `json:"intermediateDelaySeconds"`
	ExpiresAt                *time.Time `json:"expiresAt"`
}

// RedirectService resolves public short-link access actions.
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

// Open resolves the initial public request to either a target or an intermediate page.
func (s *RedirectService) Open(ctx context.Context, slug string) (OpenResult, error) {
	slug = strings.ToLower(slug)
	link, err := s.queries.GetShortLinkBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		s.recordBlocked(ctx, slug, "")
		return OpenResult{}, ErrShortLinkMissing
	}
	if err != nil {
		return OpenResult{}, err
	}

	shortLinkID := uuidFromPgtype(link.ID)
	s.record(ctx, event.ShortLinkOpened, slug, shortLinkID)
	if err := s.checkAccess(ctx, slug, shortLinkID, link.Status, link.ExpiresAt.Valid, link.ExpiresAt.Time); err != nil {
		return OpenResult{}, err
	}

	result := OpenResult{
		RedirectResult: RedirectResult{ShortLinkID: shortLinkID},
		RedirectMode:   link.RedirectMode,
		Slug:           slug,
	}
	if link.RedirectMode == RedirectModeIntermediate {
		return result, nil
	}

	s.record(ctx, event.RedirectInitiated, slug, shortLinkID)
	result.TargetURL = link.TargetUrl
	return result, nil
}

// Preview returns event-free, non-sensitive data for an intermediate page.
func (s *RedirectService) Preview(ctx context.Context, slug string) (PreviewResult, error) {
	slug = strings.ToLower(slug)
	link, err := s.queries.GetShortLinkBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return PreviewResult{}, ErrShortLinkMissing
	}
	if err != nil {
		return PreviewResult{}, err
	}
	if link.Status != shortLinkStatusActive {
		return PreviewResult{}, ErrShortLinkDisabled
	}
	if isExpired(link.ExpiresAt.Valid, link.ExpiresAt.Time) {
		return PreviewResult{}, ErrShortLinkExpired
	}
	if link.RedirectMode != RedirectModeIntermediate {
		return PreviewResult{}, ErrShortLinkNotIntermediate
	}

	target, err := url.Parse(link.TargetUrl)
	if err != nil {
		return PreviewResult{}, fmt.Errorf("parse stored target URL: %w", err)
	}
	if target.Hostname() == "" {
		return PreviewResult{}, errors.New("stored target URL has no hostname")
	}

	return PreviewResult{
		Slug:                     slug,
		TargetHost:               target.Hostname(),
		IntermediateDelaySeconds: link.IntermediateDelaySeconds,
		ExpiresAt:                optionalTime(link.ExpiresAt.Valid, link.ExpiresAt.Time),
	}, nil
}

// Continue resolves the final target after rechecking all access conditions.
func (s *RedirectService) Continue(ctx context.Context, slug string) (RedirectResult, error) {
	slug = strings.ToLower(slug)
	link, err := s.queries.GetShortLinkBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		s.recordBlocked(ctx, slug, "")
		return RedirectResult{}, ErrShortLinkMissing
	}
	if err != nil {
		return RedirectResult{}, err
	}

	shortLinkID := uuidFromPgtype(link.ID)
	if err := s.checkAccess(ctx, slug, shortLinkID, link.Status, link.ExpiresAt.Valid, link.ExpiresAt.Time); err != nil {
		return RedirectResult{}, err
	}
	if link.RedirectMode != RedirectModeIntermediate {
		s.record(ctx, event.RedirectBlocked, slug, shortLinkID)
		return RedirectResult{}, ErrShortLinkNotIntermediate
	}

	s.record(ctx, event.RedirectInitiated, slug, shortLinkID)
	return RedirectResult{TargetURL: link.TargetUrl, ShortLinkID: shortLinkID}, nil
}

func (s *RedirectService) checkAccess(ctx context.Context, slug string, shortLinkID string, status string, expiresAtValid bool, expiresAt time.Time) error {
	s.record(ctx, event.AccessConditionChecked, slug, shortLinkID)
	if status != shortLinkStatusActive {
		s.record(ctx, event.RedirectBlocked, slug, shortLinkID)
		return ErrShortLinkDisabled
	}
	if isExpired(expiresAtValid, expiresAt) {
		s.record(ctx, event.RedirectBlocked, slug, shortLinkID)
		return ErrShortLinkExpired
	}
	return nil
}

func (s *RedirectService) recordBlocked(ctx context.Context, slug string, shortLinkID string) {
	s.record(ctx, event.AccessConditionChecked, slug, shortLinkID)
	s.record(ctx, event.RedirectBlocked, slug, shortLinkID)
}

func isExpired(valid bool, expiresAt time.Time) bool {
	return valid && !expiresAt.After(time.Now())
}

func optionalTime(valid bool, value time.Time) *time.Time {
	if !valid {
		return nil
	}
	return &value
}

// record submits a best-effort redirect event without affecting resolution.
func (s *RedirectService) record(ctx context.Context, eventType string, slug string, shortLinkID string) {
	_ = s.recorder.Record(ctx, event.Event{Type: eventType, Slug: slug, ShortLinkID: shortLinkID})
}
