package shortlink

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5/pgtype"
)

// MetadataInput replaces a managed link's title and ordered, case-sensitive tags.
type MetadataInput struct {
	Title string   `json:"title"`
	Tags  []string `json:"tags"`
}

// normalizeMetadata validates a replacement without mutating the caller's draft.
func normalizeMetadata(permissions permission.Snapshot, input *MetadataInput) (pgtype.Text, []string, error) {
	if input == nil {
		return pgtype.Text{}, nil, nil
	}
	if !permissions.Has(permission.ShortLinkSetMetadata) {
		return pgtype.Text{}, nil, ErrPermissionDenied
	}
	title := strings.TrimSpace(input.Title)
	if utf8.RuneCountInString(title) > 120 || containsControl(title) || input.Tags == nil || len(input.Tags) > 10 {
		return pgtype.Text{}, nil, ErrInvalidInput
	}
	tags := make([]string, 0, len(input.Tags))
	seen := make(map[string]struct{}, len(input.Tags))
	for _, raw := range input.Tags {
		tag := strings.TrimSpace(raw)
		if tag == "" || utf8.RuneCountInString(tag) > 32 || containsControl(tag) {
			return pgtype.Text{}, nil, ErrInvalidInput
		}
		if _, exists := seen[tag]; exists {
			return pgtype.Text{}, nil, ErrInvalidInput
		}
		seen[tag] = struct{}{}
		tags = append(tags, tag)
	}
	return pgtype.Text{String: title, Valid: true}, tags, nil
}

// containsControl rejects control characters in managed plain text.
func containsControl(value string) bool {
	return strings.ContainsFunc(value, unicode.IsControl)
}

// normalizeListFilters bounds Unicode input and escapes SQL LIKE metacharacters.
func normalizeListFilters(input ListInput) (string, string, error) {
	query, tag := strings.TrimSpace(input.Query), strings.TrimSpace(input.Tag)
	if utf8.RuneCountInString(query) > 200 || utf8.RuneCountInString(tag) > 32 || containsControl(query) || containsControl(tag) {
		return "", "", ErrInvalidInput
	}
	query = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(query)
	return query, tag, nil
}

// metadataTags preserves the API's non-null empty array contract.
func metadataTags(tags []string) []string {
	return append([]string{}, tags...)
}
