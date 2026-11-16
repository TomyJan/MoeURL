package shortlink

import (
	"context"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/jackc/pgx/v5/pgtype"
)

// SelectedListExportInput names a complete, bounded set rather than list filters or client-owned scope.
type SelectedListExportInput struct {
	IDs []string `json:"ids"`
}

// ExportSelectedList exports the complete requested set under the actor's current personal grant.
func (s *Service) ExportSelectedList(ctx context.Context, user auth.CurrentUser, input SelectedListExportInput) (ListExport, error) {
	return s.exportSelectedList(ctx, user, input, false)
}

// AdminExportSelectedList exports the complete requested set under the current administrative grant.
func (s *Service) AdminExportSelectedList(ctx context.Context, user auth.CurrentUser, input SelectedListExportInput) (ListExport, error) {
	return s.exportSelectedList(ctx, user, input, true)
}

// exportSelectedList never lets an empty or coerced selection fall through to the legacy full-list mode.
func (s *Service) exportSelectedList(ctx context.Context, user auth.CurrentUser, input SelectedListExportInput, admin bool) (ListExport, error) {
	ids, err := selectedListExportIDs(input.IDs)
	if err != nil {
		return ListExport{}, err
	}
	result, err := s.exportListSnapshot(ctx, user, ListExportInput{}, admin, "", ids)
	if err != nil {
		return ListExport{}, err
	}
	result.FileName = "moeurl-links-own-selected.csv"
	if admin {
		result.FileName = "moeurl-links-all-selected.csv"
	}
	return result, nil
}

// selectedListExportIDs rejects lossy normalization, duplicates and every out-of-bound selection.
func selectedListExportIDs(raw []string) ([]pgtype.UUID, error) {
	if len(raw) < 1 || len(raw) > 100 {
		return nil, ErrInvalidInput
	}
	ids := make([]pgtype.UUID, 0, len(raw))
	seen := make(map[string]bool, len(raw))
	for _, text := range raw {
		id, err := parseNoteID(text)
		if err != nil || seen[text] {
			return nil, ErrInvalidInput
		}
		seen[text] = true
		ids = append(ids, uuidToPgtype(id))
	}
	return ids, nil
}
