package shortlink

import (
	"context"
	"net/url"
	"strings"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
)

// normalizeNoteStatus accepts only the exact stored-note presence predicates.
func normalizeNoteStatus(value string) (string, error) {
	switch value {
	case "", "present", "absent":
		return value, nil
	default:
		return "", ErrInvalidInput
	}
}

// noteStatusQuery rejects ambiguous new filters without changing valid legacy list parameters.
func noteStatusQuery(raw string) (string, error) {
	values, err := url.ParseQuery(raw)
	if err != nil {
		return "", ErrInvalidInput
	}
	if items, exists := values["noteStatus"]; exists {
		if len(items) != 1 {
			return "", ErrInvalidInput
		}
		for _, part := range strings.Split(raw, "&") {
			key, _, hasEquals := strings.Cut(part, "=")
			decoded, _ := url.QueryUnescape(key) // ParseQuery already validated every escape.
			if decoded == "noteStatus" && !hasEquals {
				return "", ErrInvalidInput
			}
		}
	}
	return normalizeNoteStatus(values.Get("noteStatus"))
}

// noteStatusListQueries pins current authorization and count/list to one read-only snapshot.
// The caller bounds the full filtered operation, including entrance authorization, to five seconds.
func (s *Service) noteStatusListQueries(ctx context.Context, actor auth.CurrentUser, status string, admin bool) (*sqlc.Queries, func(), error) {
	if _, err := normalizeNoteStatus(status); err != nil {
		return nil, nil, err
	}
	if status == "" {
		return s.queries, func() {}, nil
	}
	id, err := parseNoteID(actor.ID)
	if err != nil {
		return nil, nil, ErrPermissionDenied
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, nil, err
	}
	finish := func() { _ = tx.Rollback(ctx) }
	q := s.queries.WithTx(tx)
	allowed, err := q.CheckShortLinkNoteListActor(ctx, sqlc.CheckShortLinkNoteListActorParams{ActorID: uuidToPgtype(id), AdminScope: admin})
	if err != nil {
		finish()
		return nil, nil, err
	}
	if !allowed {
		finish()
		return nil, nil, ErrPermissionDenied
	}
	return q, finish, nil
}
