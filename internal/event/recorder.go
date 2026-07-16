package event

import (
	"context"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DBRecorder struct {
	queries *sqlc.Queries
}

func NewRecorder(pool *pgxpool.Pool) *DBRecorder {
	return &DBRecorder{queries: sqlc.New(pool)}
}

func (r *DBRecorder) Record(ctx context.Context, event Event) error {
	if event.ShortLinkID == "" {
		return nil
	}
	shortLinkID, err := uuid.Parse(event.ShortLinkID)
	if err != nil {
		return err
	}
	return r.queries.CreateShortLinkEvent(ctx, sqlc.CreateShortLinkEventParams{
		ID:          pgtypeUUID(uuid.New()),
		ShortLinkID: pgtypeUUID(shortLinkID),
		EventType:   event.Type,
	})
}

func pgtypeUUID(value uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: value, Valid: true}
}
