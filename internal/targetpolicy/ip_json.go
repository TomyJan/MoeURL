package targetpolicy

import (
	"encoding/json"
	"io"
	"slices"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

// decodeIPUpdate requires a bounded complete object with neither nulls nor extras.
func decodeIPUpdate(body io.Reader) (IPUpdateInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 32769))
	if err != nil || len(raw) > 32768 {
		return IPUpdateInput{}, ErrInvalidInput
	}
	fields, err := decodeObject(raw, "addresses", "expectedUpdatedAt")
	if err != nil {
		return IPUpdateInput{}, err
	}
	var input IPUpdateInput
	if json.Unmarshal(fields["addresses"], &input.Addresses) != nil || json.Unmarshal(fields["expectedUpdatedAt"], &input.ExpectedUpdatedAt) != nil {
		return IPUpdateInput{}, ErrInvalidInput
	}
	return input, nil
}

// storedIPSettings fails closed rather than repairing noncanonical stored values.
func storedIPSettings(row sqlc.SystemSetting) (IPSettings, error) {
	fields, err := decodeObject(row.Value, "addresses")
	if err != nil {
		return IPSettings{}, ErrCorrupt
	}
	var addresses []string
	if json.Unmarshal(fields["addresses"], &addresses) != nil {
		return IPSettings{}, ErrCorrupt
	}
	normalized, err := normalizeIPs(addresses)
	if err != nil || !slices.Equal(normalized, addresses) || row.Key != IPKey || !row.UpdatedAt.Valid || row.UpdatedAt.InfinityModifier != pgtype.Finite {
		return IPSettings{}, ErrCorrupt
	}
	version := row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano)
	if _, err := parseVersion(version); err != nil {
		return IPSettings{}, ErrCorrupt
	}
	return IPSettings{Addresses: normalized, UpdatedAt: version}, nil
}
