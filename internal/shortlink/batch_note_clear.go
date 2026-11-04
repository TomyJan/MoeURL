package shortlink

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// BatchNotePreviewItem pins the list revision selected by the caller.
type BatchNotePreviewItem struct {
	ID                string `json:"id"`
	ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
}

type BatchNotePreviewInput struct {
	Items []BatchNotePreviewItem `json:"items"`
}

// BatchNoteClearItem pins both the original list revision and the previewed private-note revision.
type BatchNoteClearItem struct {
	ID                    string `json:"id"`
	ExpectedUpdatedAt     string `json:"expectedUpdatedAt"`
	ExpectedNoteUpdatedAt string `json:"expectedNoteUpdatedAt"`
}

type BatchNoteClearInput struct {
	Items []BatchNoteClearItem `json:"items"`
}

type BatchNotePreviewResultItem struct {
	ID                    string `json:"id"`
	ExpectedUpdatedAt     string `json:"expectedUpdatedAt"`
	ExpectedNoteUpdatedAt string `json:"expectedNoteUpdatedAt"`
	HasNote               bool   `json:"hasNote"`
}

// BatchNotePreviewResult never carries note text, only versions and affected counts.
type BatchNotePreviewResult struct {
	Items         []BatchNotePreviewResultItem `json:"items"`
	NonemptyCount int                          `json:"nonemptyCount"`
	EmptyCount    int                          `json:"emptyCount"`
}

type BatchNoteClearResult struct {
	ChangedCount   int `json:"changedCount"`
	UnchangedCount int `json:"unchangedCount"`
}

type batchNoteVersions struct{ main, note time.Time }

func previewNoteItems(input BatchNotePreviewInput) []BatchNoteClearItem {
	items := make([]BatchNoteClearItem, len(input.Items))
	for i, item := range input.Items {
		items[i] = BatchNoteClearItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt}
	}
	return items
}

// normalizeBatchNoteItems protects non-HTTP callers with the same bounded, lossless contract.
func normalizeBatchNoteItems(items []BatchNoteClearItem, clear bool) ([]pgtype.UUID, map[uuid.UUID]batchNoteVersions, error) {
	if len(items) < 1 || len(items) > 100 {
		return nil, nil, ErrInvalidInput
	}
	ids := make([]pgtype.UUID, 0, len(items))
	versions := make(map[uuid.UUID]batchNoteVersions, len(items))
	for _, item := range items {
		id, err := parseNoteID(item.ID)
		if err != nil {
			return nil, nil, err
		}
		if _, exists := versions[id]; exists {
			return nil, nil, ErrInvalidInput
		}
		main, err := parseNoteVersion(item.ExpectedUpdatedAt)
		if err != nil {
			return nil, nil, err
		}
		var note time.Time
		if clear {
			note, err = parseNoteVersion(item.ExpectedNoteUpdatedAt)
			if err != nil {
				return nil, nil, err
			}
		}
		ids = append(ids, uuidToPgtype(id))
		versions[id] = batchNoteVersions{main, note}
	}
	return ids, versions, nil
}
