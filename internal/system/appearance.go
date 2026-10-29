package system

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

const appearanceKey = "site.appearance"

var (
	ErrInvalidAppearance     = errors.New("invalid appearance")
	ErrAppearanceConflict    = errors.New("appearance conflict")
	ErrCorruptAppearance     = errors.New("corrupt persisted appearance")
	appearanceVersionPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$`)
)

// Appearance is the complete public projection of the site's fixed accent.
type Appearance struct {
	AccentPreset string `json:"accentPreset"`
}

// AppearanceSettings adds only the independent management revision.
type AppearanceSettings struct {
	Appearance
	UpdatedAt string `json:"updatedAt"`
}

// UpdateAppearanceInput replaces the preset against a complete revision.
type UpdateAppearanceInput struct {
	AccentPreset      string
	ExpectedUpdatedAt string
}

func normalizeAppearance(preset string) (Appearance, error) {
	switch preset {
	case "iris", "ocean", "forest":
		return Appearance{AccentPreset: preset}, nil
	default:
		return Appearance{}, ErrInvalidAppearance
	}
}

func appearanceVersion(raw string) (time.Time, error) {
	if !appearanceVersionPattern.MatchString(raw) {
		return time.Time{}, ErrInvalidAppearance
	}
	version, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil || version.IsZero() {
		return time.Time{}, ErrInvalidAppearance
	}
	return version, nil
}

// storedAppearance fails closed; an absent or malformed saved preset must never
// be silently replaced with a server-side default or leak into an error message.
func storedAppearance(row sqlc.SystemSetting) (AppearanceSettings, error) {
	var value struct {
		AccentPreset *string `json:"accentPreset"`
	}
	decoder := json.NewDecoder(bytes.NewReader(row.Value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil || value.AccentPreset == nil {
		return AppearanceSettings{}, ErrCorruptAppearance
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return AppearanceSettings{}, ErrCorruptAppearance
	}
	appearance, err := normalizeAppearance(*value.AccentPreset)
	if err != nil || row.Key != appearanceKey || !row.UpdatedAt.Valid || row.UpdatedAt.InfinityModifier != pgtype.Finite || row.UpdatedAt.Time.IsZero() {
		return AppearanceSettings{}, ErrCorruptAppearance
	}
	version := row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano)
	if _, err := appearanceVersion(version); err != nil {
		return AppearanceSettings{}, ErrCorruptAppearance
	}
	return AppearanceSettings{Appearance: appearance, UpdatedAt: version}, nil
}
