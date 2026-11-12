package targetpolicy

import (
	"encoding/json"
	"io"
	"slices"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

// decodeSuffixUpdate bounds allocation before constructing a complete CAS command.
func decodeSuffixUpdate(body io.Reader) (SuffixUpdateInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 32769))
	if err != nil || len(raw) > 32768 {
		return SuffixUpdateInput{}, ErrInvalidInput
	}
	fields, err := decodeObject(raw, "suffixes", "expectedUpdatedAt")
	if err != nil {
		return SuffixUpdateInput{}, err
	}
	var input SuffixUpdateInput
	if json.Unmarshal(fields["suffixes"], &input.Suffixes) != nil || json.Unmarshal(fields["expectedUpdatedAt"], &input.ExpectedUpdatedAt) != nil {
		return SuffixUpdateInput{}, ErrInvalidInput
	}
	return input, nil
}

// storedSuffixSettings refuses noncanonical data; reads never reorder or repair it.
func storedSuffixSettings(row sqlc.SystemSetting) (SuffixSettings, error) {
	fields, err := decodeObject(row.Value, "suffixes")
	if err != nil {
		return SuffixSettings{}, ErrCorrupt
	}
	var hosts []string
	if json.Unmarshal(fields["suffixes"], &hosts) != nil {
		return SuffixSettings{}, ErrCorrupt
	}
	normalized, err := normalizeHosts(hosts)
	if err != nil || !slices.Equal(normalized, hosts) || row.Key != SuffixKey || !row.UpdatedAt.Valid || row.UpdatedAt.InfinityModifier != pgtype.Finite {
		return SuffixSettings{}, ErrCorrupt
	}
	version := row.UpdatedAt.Time.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")
	if _, err := parseVersion(version); err != nil {
		return SuffixSettings{}, ErrCorrupt
	}
	return SuffixSettings{Suffixes: normalized, UpdatedAt: version}, nil
}
