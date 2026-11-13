package targetpolicy

import (
	"encoding/json"
	"io"
	"slices"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

// decodeCIDRUpdate requires a bounded complete object with neither nulls nor extras.
func decodeCIDRUpdate(body io.Reader) (CIDRUpdateInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 32769))
	if err != nil || len(raw) > 32768 {
		return CIDRUpdateInput{}, ErrInvalidInput
	}
	fields, err := decodeObject(raw, "prefixes", "expectedUpdatedAt")
	if err != nil {
		return CIDRUpdateInput{}, err
	}
	var input CIDRUpdateInput
	if json.Unmarshal(fields["prefixes"], &input.Prefixes) != nil || json.Unmarshal(fields["expectedUpdatedAt"], &input.ExpectedUpdatedAt) != nil {
		return CIDRUpdateInput{}, ErrInvalidInput
	}
	return input, nil
}

// storedCIDRSettings fails closed rather than repairing noncanonical stored values.
func storedCIDRSettings(row sqlc.SystemSetting) (CIDRSettings, error) {
	fields, err := decodeObject(row.Value, "prefixes")
	if err != nil {
		return CIDRSettings{}, ErrCorrupt
	}
	var prefixes []string
	if json.Unmarshal(fields["prefixes"], &prefixes) != nil {
		return CIDRSettings{}, ErrCorrupt
	}
	normalized, err := normalizeCIDRs(prefixes)
	if err != nil || !slices.Equal(normalized, prefixes) || row.Key != CIDRKey || !row.UpdatedAt.Valid || row.UpdatedAt.InfinityModifier != pgtype.Finite {
		return CIDRSettings{}, ErrCorrupt
	}
	version := row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano)
	if _, err := parseVersion(version); err != nil {
		return CIDRSettings{}, ErrCorrupt
	}
	return CIDRSettings{Prefixes: normalized, UpdatedAt: version}, nil
}
