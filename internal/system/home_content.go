package system

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

const homeContentKey = "site.home_content"

var (
	ErrInvalidHomeContent     = errors.New("invalid home content")
	ErrHomeContentConflict    = errors.New("home content conflict")
	ErrCorruptHomeContent     = errors.New("corrupt persisted home content")
	homeContentVersionPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$`)
)

// HomeContent contains only the public, unlocalized plain-text overrides.
type HomeContent struct {
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

// HomeContentSettings adds the independent full-precision management revision.
type HomeContentSettings struct {
	HomeContent
	UpdatedAt string `json:"updatedAt"`
}

// UpdateHomeContentInput replaces both values against one complete revision.
type UpdateHomeContentInput struct {
	Title             string
	Summary           string
	ExpectedUpdatedAt string
}

// normalizeHomeContent rejects controls before trimming and counts Unicode
// codepoints rather than bytes or UTF16 units. It never interprets markup.
func normalizeHomeContent(title, summary string) (HomeContent, error) {
	values := []*string{&title, &summary}
	limits := []int{80, 200}
	for i, value := range values {
		if !utf8.ValidString(*value) {
			return HomeContent{}, ErrInvalidHomeContent
		}
		for _, r := range *value {
			if unicode.IsControl(r) {
				return HomeContent{}, ErrInvalidHomeContent
			}
		}
		*value = strings.TrimSpace(*value)
		if utf8.RuneCountInString(*value) > limits[i] {
			return HomeContent{}, ErrInvalidHomeContent
		}
	}
	return HomeContent{Title: title, Summary: summary}, nil
}

// homeContentVersion rejects ambiguous or zero timestamps before a transaction.
func homeContentVersion(raw string) (time.Time, error) {
	if !homeContentVersionPattern.MatchString(raw) {
		return time.Time{}, ErrInvalidHomeContent
	}
	version, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil || version.IsZero() {
		return time.Time{}, ErrInvalidHomeContent
	}
	return version, nil
}

// storedHomeContent fails closed on missing fields, unknown data, invalid text,
// noncanonical whitespace or an unusable revision. No saved copy enters errors.
func storedHomeContent(row sqlc.SystemSetting) (HomeContentSettings, error) {
	var value struct {
		Title   *string `json:"title"`
		Summary *string `json:"summary"`
	}
	decoder := json.NewDecoder(bytes.NewReader(row.Value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil || value.Title == nil || value.Summary == nil {
		return HomeContentSettings{}, ErrCorruptHomeContent
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return HomeContentSettings{}, ErrCorruptHomeContent
	}
	normalized, err := normalizeHomeContent(*value.Title, *value.Summary)
	if err != nil || normalized.Title != *value.Title || normalized.Summary != *value.Summary ||
		row.Key != homeContentKey || !row.UpdatedAt.Valid || row.UpdatedAt.InfinityModifier != pgtype.Finite || row.UpdatedAt.Time.IsZero() {
		return HomeContentSettings{}, ErrCorruptHomeContent
	}
	version := row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano)
	if _, err := homeContentVersion(version); err != nil {
		return HomeContentSettings{}, ErrCorruptHomeContent
	}
	return HomeContentSettings{HomeContent: normalized, UpdatedAt: version}, nil
}
