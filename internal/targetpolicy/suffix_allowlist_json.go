package targetpolicy

import (
	"encoding/json"
	"io"
	"slices"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

// decodeSuffixAllowlistUpdate requires an actual boolean and all three bounded fields.
func decodeSuffixAllowlistUpdate(body io.Reader) (SuffixAllowlistUpdateInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 32769))
	if err != nil || len(raw) > 32768 {
		return SuffixAllowlistUpdateInput{}, ErrInvalidInput
	}
	fields, err := decodeObject(raw, "enabled", "suffixes", "expectedUpdatedAt")
	if err != nil {
		return SuffixAllowlistUpdateInput{}, err
	}
	var input SuffixAllowlistUpdateInput
	if json.Unmarshal(fields["enabled"], &input.Enabled) != nil || json.Unmarshal(fields["suffixes"], &input.Suffixes) != nil || json.Unmarshal(fields["expectedUpdatedAt"], &input.ExpectedUpdatedAt) != nil {
		return SuffixAllowlistUpdateInput{}, ErrInvalidInput
	}
	return input, nil
}

// storedSuffixAllowlistSettings rejects corrupt data even while the policy is off.
func storedSuffixAllowlistSettings(row sqlc.SystemSetting) (SuffixAllowlistSettings, error) {
	fields, err := decodeObject(row.Value, "enabled", "suffixes")
	if err != nil {
		return SuffixAllowlistSettings{}, ErrCorrupt
	}
	var enabled bool
	var hosts []string
	if json.Unmarshal(fields["enabled"], &enabled) != nil || json.Unmarshal(fields["suffixes"], &hosts) != nil {
		return SuffixAllowlistSettings{}, ErrCorrupt
	}
	normalized, err := normalizeHosts(hosts)
	if err != nil || enabled && len(normalized) == 0 || !slices.Equal(normalized, hosts) || row.Key != SuffixAllowlistKey || !row.UpdatedAt.Valid || row.UpdatedAt.InfinityModifier != pgtype.Finite {
		return SuffixAllowlistSettings{}, ErrCorrupt
	}
	version := row.UpdatedAt.Time.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")
	if _, err := parseVersion(version); err != nil {
		return SuffixAllowlistSettings{}, ErrCorrupt
	}
	return SuffixAllowlistSettings{Enabled: enabled, Suffixes: normalized, UpdatedAt: version}, nil
}
