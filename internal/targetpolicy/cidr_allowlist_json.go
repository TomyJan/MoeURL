package targetpolicy

import (
	"encoding/json"
	"io"
	"slices"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

// decodeCIDRAllowlistUpdate requires an actual boolean and all three bounded fields.
func decodeCIDRAllowlistUpdate(body io.Reader) (CIDRAllowlistUpdateInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 32769))
	if err != nil || len(raw) > 32768 {
		return CIDRAllowlistUpdateInput{}, ErrInvalidInput
	}
	fields, err := decodeObject(raw, "enabled", "prefixes", "expectedUpdatedAt")
	if err != nil {
		return CIDRAllowlistUpdateInput{}, err
	}
	var input CIDRAllowlistUpdateInput
	if json.Unmarshal(fields["enabled"], &input.Enabled) != nil || json.Unmarshal(fields["prefixes"], &input.Prefixes) != nil || json.Unmarshal(fields["expectedUpdatedAt"], &input.ExpectedUpdatedAt) != nil {
		return CIDRAllowlistUpdateInput{}, ErrInvalidInput
	}
	return input, nil
}

// storedCIDRAllowlistSettings rejects corrupt data even while the policy is off.
func storedCIDRAllowlistSettings(row sqlc.SystemSetting) (CIDRAllowlistSettings, error) {
	fields, err := decodeObject(row.Value, "enabled", "prefixes")
	if err != nil {
		return CIDRAllowlistSettings{}, ErrCorrupt
	}
	var enabled bool
	var prefixes []string
	if json.Unmarshal(fields["enabled"], &enabled) != nil || json.Unmarshal(fields["prefixes"], &prefixes) != nil {
		return CIDRAllowlistSettings{}, ErrCorrupt
	}
	normalized, err := normalizeCIDRs(prefixes)
	if err != nil || enabled && len(normalized) == 0 || !slices.Equal(normalized, prefixes) || row.Key != CIDRAllowlistKey || !row.UpdatedAt.Valid || row.UpdatedAt.InfinityModifier != pgtype.Finite {
		return CIDRAllowlistSettings{}, ErrCorrupt
	}
	version := row.UpdatedAt.Time.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")
	if _, err := parseVersion(version); err != nil {
		return CIDRAllowlistSettings{}, ErrCorrupt
	}
	return CIDRAllowlistSettings{Enabled: enabled, Prefixes: normalized, UpdatedAt: version}, nil
}
