package targetpolicy

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

// decodeObject rejects duplicates, unknown fields, nulls and trailing documents.
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
		if _, ok := fields[key]; ok {
			return nil, ErrInvalidInput
		}
		var value json.RawMessage
		if d.Decode(&value) != nil || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
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

// decodeUpdate bounds allocation before constructing a complete CAS command.
func decodeUpdate(body io.Reader) (UpdateInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 32769))
	if err != nil || len(raw) > 32768 {
		return UpdateInput{}, ErrInvalidInput
	}
	fields, err := decodeObject(raw, "hosts", "expectedUpdatedAt")
	if err != nil {
		return UpdateInput{}, err
	}
	var input UpdateInput
	if json.Unmarshal(fields["hosts"], &input.Hosts) != nil || json.Unmarshal(fields["expectedUpdatedAt"], &input.ExpectedUpdatedAt) != nil {
		return UpdateInput{}, ErrInvalidInput
	}
	return input, nil
}

// storedSettings refuses noncanonical data; reads never reorder or repair it.
func storedSettings(row sqlc.SystemSetting) (Settings, error) {
	fields, err := decodeObject(row.Value, "hosts")
	if err != nil {
		return Settings{}, ErrCorrupt
	}
	var hosts []string
	if json.Unmarshal(fields["hosts"], &hosts) != nil {
		return Settings{}, ErrCorrupt
	}
	normalized, err := normalizeHosts(hosts)
	if err != nil || !slices.Equal(normalized, hosts) || row.Key != Key || !row.UpdatedAt.Valid || row.UpdatedAt.InfinityModifier != pgtype.Finite {
		return Settings{}, ErrCorrupt
	}
	version := row.UpdatedAt.Time.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")
	if _, err := parseVersion(version); err != nil {
		return Settings{}, ErrCorrupt
	}
	return Settings{Hosts: normalized, UpdatedAt: version}, nil
}
