package event

import (
	"context"
	"log/slog"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const recordTimeout = 500 * time.Millisecond

// DBRecorder records short link visit events in PostgreSQL.
type DBRecorder struct {
	queries *sqlc.Queries
	logger  *slog.Logger
}

// NewRecorder creates a database-backed event recorder.
func NewRecorder(pool *pgxpool.Pool, logger *slog.Logger) *DBRecorder {
	return &DBRecorder{queries: sqlc.New(pool), logger: logger}
}

// Record validates and queues a short link visit event for best-effort persistence.
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
		if err := r.queries.CreateShortLinkEvent(writeCtx, params); err != nil {
			r.logger.Warn("short_link_event_record_failed",
				"event_type", event.Type,
				"short_link_id", event.ShortLinkID,
				"err", err,
			)
		}
	}()
	return nil
}

func pgtypeUUID(value uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: value, Valid: true}
}
