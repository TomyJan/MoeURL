package targetpolicy

import (
	"encoding/json"
	"io"
	"slices"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

// decodeAllowlistUpdate requires an actual boolean and all three bounded fields.
func decodeAllowlistUpdate(body io.Reader) (AllowlistUpdateInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 32769))
	if err != nil || len(raw) > 32768 {
		return AllowlistUpdateInput{}, ErrInvalidInput
	}
	fields, err := decodeObject(raw, "enabled", "hosts", "expectedUpdatedAt")
	if err != nil {
		return AllowlistUpdateInput{}, err
	}
	var input AllowlistUpdateInput
	if json.Unmarshal(fields["enabled"], &input.Enabled) != nil || json.Unmarshal(fields["hosts"], &input.Hosts) != nil || json.Unmarshal(fields["expectedUpdatedAt"], &input.ExpectedUpdatedAt) != nil {
		return AllowlistUpdateInput{}, ErrInvalidInput
	}
	return input, nil
}

// storedAllowlistSettings rejects corrupt data even while the policy is off.
func storedAllowlistSettings(row sqlc.SystemSetting) (AllowlistSettings, error) {
	fields, err := decodeObject(row.Value, "enabled", "hosts")
	if err != nil {
		return AllowlistSettings{}, ErrCorrupt
	}
	var enabled bool
	var hosts []string
	if json.Unmarshal(fields["enabled"], &enabled) != nil || json.Unmarshal(fields["hosts"], &hosts) != nil {
		return AllowlistSettings{}, ErrCorrupt
	}
	normalized, err := normalizeHosts(hosts)
	if err != nil || enabled && len(normalized) == 0 || !slices.Equal(normalized, hosts) || row.Key != AllowlistKey || !row.UpdatedAt.Valid || row.UpdatedAt.InfinityModifier != pgtype.Finite {
		return AllowlistSettings{}, ErrCorrupt
	}
	version := row.UpdatedAt.Time.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")
	if _, err := parseVersion(version); err != nil {
		return AllowlistSettings{}, ErrCorrupt
	}
	return AllowlistSettings{Enabled: enabled, Hosts: normalized, UpdatedAt: version}, nil
}

// checkAllowlistHosts imposes no new URL syntax while off; when on, an IP's
// empty DNS classification must fail rather than becoming an allowed target.
func checkAllowlistHosts(settings AllowlistSettings, targets []string) error {
	if !settings.Enabled {
		return nil
	}
	for _, target := range targets {
		host, err := targetHost(target)
		if err != nil {
			return err
		}
		if _, found := slices.BinarySearch(settings.Hosts, host); !found {
			return ErrTargetDenied
		}
	}
	return nil
}
