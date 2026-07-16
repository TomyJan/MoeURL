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

const (
	recordTimeout         = 500 * time.Millisecond
	recordConcurrentLimit = 16
)

// shortLinkEventWriter persists short link visit events.
type shortLinkEventWriter interface {
	CreateShortLinkEvent(context.Context, sqlc.CreateShortLinkEventParams) error
}

// DBRecorder records short link visit events in PostgreSQL.
type DBRecorder struct {
	writer     shortLinkEventWriter
	logger     *slog.Logger
	writeSlots chan struct{}
}

// NewRecorder creates a database-backed event recorder.
func NewRecorder(pool *pgxpool.Pool, logger *slog.Logger) *DBRecorder {
	return newDBRecorder(sqlc.New(pool), logger, recordConcurrentLimit)
}

// newDBRecorder creates a recorder with a bounded number of concurrent writes.
func newDBRecorder(writer shortLinkEventWriter, logger *slog.Logger, concurrentLimit int) *DBRecorder {
	return &DBRecorder{writer: writer, logger: logger, writeSlots: make(chan struct{}, concurrentLimit)}
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
	select {
	case r.writeSlots <- struct{}{}:
	default:
		r.logger.Warn("short_link_event_record_dropped",
			"reason", "concurrency_limit",
			"event_type", event.Type,
			"short_link_id", event.ShortLinkID,
		)
		return nil
	}
	go func() {
		defer func() { <-r.writeSlots }()
		writeCtx, cancel := context.WithTimeout(context.Background(), recordTimeout)
		defer cancel()
		if err := r.writer.CreateShortLinkEvent(writeCtx, params); err != nil {
			r.logger.Warn("short_link_event_record_failed",
				"event_type", event.Type,
				"short_link_id", event.ShortLinkID,
				"err", err,
			)
		}
	}()
	return nil
}

// pgtypeUUID implements package-specific behavior.
func pgtypeUUID(value uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: value, Valid: true}
}
