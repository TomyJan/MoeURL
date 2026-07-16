package event

import (
	"context"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const recordTimeout = 500 * time.Millisecond

type DBRecorder struct {
	queries *sqlc.Queries
}

func NewRecorder(pool *pgxpool.Pool) *DBRecorder {
	return &DBRecorder{queries: sqlc.New(pool)}
}

func (r *DBRecorder) Record(_ context.Context, event Event) error {
	if event.ShortLinkID == "" {
		return nil
	}
	shortLinkID, err := uuid.Parse(event.ShortLinkID)
	if err != nil {
		return err
	}
	if event.Type != RedirectResponseSent {
		return nil
	}
	params := sqlc.CreateShortLinkEventParams{
		ID:          pgtypeUUID(uuid.New()),
		ShortLinkID: pgtypeUUID(shortLinkID),
		EventType:   event.Type,
	}
	go func() {
		writeCtx, cancel := context.WithTimeout(context.Background(), recordTimeout)
		defer cancel()
		_ = r.queries.CreateShortLinkEvent(writeCtx, params)
	}()
	return nil
}

func pgtypeUUID(value uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: value, Valid: true}
}
