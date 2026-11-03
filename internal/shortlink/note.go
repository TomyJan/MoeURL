package shortlink

import (
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

// NoteInput replaces only a note using its own complete concurrency version.
type NoteInput struct {
	ID                string `json:"id"`
	Note              string `json:"note"`
	ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
}

// NoteResult is private management text and its independent note revision.
type NoteResult struct {
	ID        string `json:"id"`
	Note      string `json:"note"`
	UpdatedAt string `json:"updatedAt"`
}

// normalizeNote validates scalars and controls before applying Go whitespace trimming.
func normalizeNote(raw string) (string, error) {
	if !utf8.ValidString(raw) {
		return "", ErrInvalidInput
	}
	value := strings.ReplaceAll(raw, "\r\n", "\n")
	if strings.ContainsFunc(value, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' }) {
		return "", ErrInvalidInput
	}
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > 1000 {
		return "", ErrInvalidInput
	}
	return value, nil
}

// parseNoteID rejects noncanonical and zero resource identifiers.
func parseNoteID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil || id.String() != raw {
		return uuid.Nil, ErrInvalidInput
	}
	return id, nil
}

// parseNoteVersion retains all fractional precision and rejects unreturnable years.
func parseNoteVersion(raw string) (time.Time, error) {
	v, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil || v.IsZero() || v.Year() < 1 || v.Year() > 9999 || v.UTC().Year() < 1 || v.UTC().Year() > 9999 {
		return time.Time{}, ErrInvalidInput
	}
	return v, nil
}
