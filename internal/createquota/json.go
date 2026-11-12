package createquota

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

// decodeObject rejects missing, repeated and unknown keys without conflating
// an explicitly nullable dailyLimit with a missing command field.
func decodeObject(raw []byte, keys ...string) (map[string]json.RawMessage, error) {
	if !utf8.Valid(raw) {
		return nil, ErrInvalidInput
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return nil, ErrInvalidInput
	}
	fields := make(map[string]json.RawMessage, len(keys))
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || !slices.Contains(keys, key) {
			return nil, ErrInvalidInput
		}
		if _, found := fields[key]; found {
			return nil, ErrInvalidInput
		}
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return nil, ErrInvalidInput
		}
		fields[key] = value
	}
	if closing, err := d.Token(); err != nil || closing != json.Delim('}') || len(fields) != len(keys) {
		return nil, ErrInvalidInput
	}
	if !errors.Is(d.Decode(new(any)), io.EOF) {
		return nil, ErrInvalidInput
	}
	return fields, nil
}

// parseLimit accepts JSON null or a bounded integer token without coercion.
func parseLimit(raw json.RawMessage) (*int64, error) {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	var limit int64
	if json.Unmarshal(raw, &limit) != nil || !validLimit(&limit) {
		return nil, ErrInvalidInput
	}
	return &limit, nil
}

// decodeUpdate bounds allocation and requires the complete independent command.
func decodeUpdate(body io.Reader) (UpdateInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 4097))
	if err != nil || len(raw) > 4096 {
		return UpdateInput{}, ErrInvalidInput
	}
	fields, err := decodeObject(raw, "dailyLimit", "expectedUpdatedAt")
	if err != nil {
		return UpdateInput{}, err
	}
	limit, err := parseLimit(fields["dailyLimit"])
	if err != nil {
		return UpdateInput{}, err
	}
	var revision string
	if bytes.Equal(bytes.TrimSpace(fields["expectedUpdatedAt"]), []byte("null")) || json.Unmarshal(fields["expectedUpdatedAt"], &revision) != nil {
		return UpdateInput{}, ErrInvalidInput
	}
	return UpdateInput{DailyLimit: limit, ExpectedUpdatedAt: revision}, nil
}

// storedSettings refuses to repair invalid persisted data during a read.
func storedSettings(row sqlc.SystemSetting) (Settings, error) {
	fields, err := decodeObject(row.Value, "dailyLimit")
	if err != nil {
		return Settings{}, ErrCorrupt
	}
	limit, err := parseLimit(fields["dailyLimit"])
	if err != nil || row.Key != Key || !row.UpdatedAt.Valid || row.UpdatedAt.InfinityModifier != pgtype.Finite {
		return Settings{}, ErrCorrupt
	}
	revision := row.UpdatedAt.Time.UTC().Format(timeLayout)
	if _, err := parseVersion(revision); err != nil {
		return Settings{}, ErrCorrupt
	}
	return Settings{DailyLimit: limit, UpdatedAt: revision}, nil
}

const timeLayout = "2006-01-02T15:04:05.999999999Z07:00"
