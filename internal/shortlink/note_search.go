package shortlink

import (
	"context"
	"math"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// NoteSearchInput keeps the private word separate from the legacy list filters.
type NoteSearchInput struct {
	ListInput
	NoteQuery string
}

// normalizeNoteQuery rejects controls before trimming and counts Unicode scalar values.
func normalizeNoteQuery(value string) (string, error) {
	if !utf8.ValidString(value) {
		return "", ErrInvalidInput
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return "", ErrInvalidInput
		}
	}
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > 100 {
		return "", ErrInvalidInput
	}
	return value, nil
}

// validateNoteSearch checks direct service calls as well as decoded HTTP requests.
func validateNoteSearch(input NoteSearchInput, export bool) (string, error) {
	if !export && (input.Page < 1 || input.PageSize < 1 || input.PageSize > 100 || int64(input.Page-1)*int64(input.PageSize) > math.MaxInt32) {
		return "", ErrInvalidInput
	}
	return normalizeNoteQuery(input.NoteQuery)
}

// SearchOwnNotes reads the actor's metadata under a fresh current-grant snapshot.
func (s *Service) SearchOwnNotes(ctx context.Context, user auth.CurrentUser, input NoteSearchInput) (ListResult, error) {
	word, err := validateNoteSearch(input, false)
	if err != nil {
		return ListResult{}, err
	}
	return s.list(ctx, user, input.ListInput, word, true)
}

// SearchAdminNotes reads global metadata under a fresh administrative-grant snapshot.
func (s *Service) SearchAdminNotes(ctx context.Context, user auth.CurrentUser, input NoteSearchInput) (AdminListResult, error) {
	word, err := validateNoteSearch(input, false)
	if err != nil {
		return AdminListResult{}, err
	}
	return s.adminList(ctx, user, input.ListInput, word, true)
}

// ExportOwnNoteSearch exports all authorized personal matches, never the private word or note.
func (s *Service) ExportOwnNoteSearch(ctx context.Context, user auth.CurrentUser, input NoteSearchInput) (ListExport, error) {
	return s.exportNoteSearch(ctx, user, input, false)
}

// ExportAdminNoteSearch exports all authorized administrative matches within the existing budgets.
func (s *Service) ExportAdminNoteSearch(ctx context.Context, user auth.CurrentUser, input NoteSearchInput) (ListExport, error) {
	return s.exportNoteSearch(ctx, user, input, true)
}

// exportNoteSearch validates private input without extending the public legacy export struct.
func (s *Service) exportNoteSearch(ctx context.Context, user auth.CurrentUser, input NoteSearchInput, admin bool) (ListExport, error) {
	word, err := validateNoteSearch(input, true)
	if err != nil {
		return ListExport{}, err
	}
	return s.exportFilteredList(ctx, user, ListExportInput{Status: input.Status, Query: input.Query, Tag: input.Tag, NoteStatus: input.NoteStatus}, admin, word)
}
