package shortlink

import (
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// BatchTagRenameInput pins a bounded selection and one exact tag rename.
type BatchTagRenameInput struct {
	Items   []BatchTagItem `json:"items"`
	FromTag string         `json:"fromTag"`
	ToTag   string         `json:"toTag"`
}

// normalizeRenameTag rejects raw controls before applying Go Unicode whitespace trimming.
func normalizeRenameTag(raw string) (string, error) {
	if !utf8.ValidString(raw) || strings.ContainsFunc(raw, unicode.IsControl) {
		return "", ErrInvalidInput
	}
	tag := strings.TrimSpace(raw)
	if tag == "" || utf8.RuneCountInString(tag) > 32 {
		return "", ErrInvalidInput
	}
	return tag, nil
}

// normalizeBatchTagRename preserves complete versions and rejects ambiguity for every caller.
func normalizeBatchTagRename(input BatchTagRenameInput) ([]pgtype.UUID, map[uuid.UUID]time.Time, string, string, error) {
	from, err := normalizeRenameTag(input.FromTag)
	if err != nil {
		return nil, nil, "", "", err
	}
	to, err := normalizeRenameTag(input.ToTag)
	if err != nil || from == to {
		return nil, nil, "", "", ErrInvalidInput
	}
	items := make([]BatchNoteClearItem, len(input.Items))
	for i, item := range input.Items {
		items[i] = BatchNoteClearItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt}
	}
	ids, versions, err := normalizeBatchNoteItems(items, false)
	if err != nil {
		return nil, nil, "", "", err
	}
	main := make(map[uuid.UUID]time.Time, len(versions))
	for id, version := range versions {
		main[id] = version.main
	}
	return ids, main, from, to, nil
}

// renameBatchTag keeps the destination's existing position, otherwise replacing the source in place.
func renameBatchTag(existing []string, from, to string) []string {
	hasTo := slices.Contains(existing, to)
	result := make([]string, 0, len(existing))
	for _, tag := range existing {
		if tag != from {
			result = append(result, tag)
		} else if !hasTo {
			result = append(result, to)
		}
	}
	return result
}
