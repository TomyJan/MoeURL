package permission

import (
	"errors"
	"fmt"
)

var (
	// ErrUnknownGroup indicates that a group has no built-in permission baseline.
	ErrUnknownGroup = errors.New("unknown user group")
	// ErrUnknownPermission indicates that a submitted permission is absent from the catalog.
	ErrUnknownPermission = errors.New("unknown permission")
	// ErrDuplicatePermission indicates that a submitted permission appears more than once.
	ErrDuplicatePermission = errors.New("duplicate permission")
	// ErrProtectedPermission indicates that a submitted set changes fixed protected ownership.
	ErrProtectedPermission = errors.New("protected permission ownership changed")
)

// Definition describes one permission exposed by the stable server catalog.
type Definition struct {
	Key       string `json:"key"`
	Category  string `json:"category"`
	Protected bool   `json:"protected"`
}

// Preset describes a static configurable permission set and its applicable groups.
type Preset struct {
	Key              string   `json:"key"`
	ApplicableGroups []string `json:"applicableGroups"`
	Permissions      []string `json:"permissions"`
}

var catalogDefinitions = expectedDefinitions()
var catalogPresets = expectedPresets()

// Definitions returns an independent copy of the stable permission catalog.
func Definitions() []Definition {
	result := make([]Definition, len(catalogDefinitions))
	copy(result, catalogDefinitions)
	return result
}

// Presets returns independent deep copies of the static permission presets.
func Presets() []Preset {
	result := make([]Preset, len(catalogPresets))
	for index, preset := range catalogPresets {
		result[index] = Preset{
			Key:              preset.Key,
			ApplicableGroups: cloneStrings(preset.ApplicableGroups),
			Permissions:      cloneStrings(preset.Permissions),
		}
	}
	return result
}

// CatalogKeys returns every catalog permission in stable definition order.
func CatalogKeys() []string {
	result := make([]string, len(catalogDefinitions))
	for index, definition := range catalogDefinitions {
		result[index] = definition.Key
	}
	return result
}

// ValidateCatalog verifies that the package catalog and presets match their fixed contract.
func ValidateCatalog() error {
	return validateCatalog(catalogDefinitions, catalogPresets)
}

// NormalizeForGroup validates a complete permission set and returns it in catalog order.
func NormalizeForGroup(groupKey string, values []string) ([]string, error) {
	switch groupKey {
	case GroupGuest, GroupUser, GroupAdmin:
	default:
		return nil, fmt.Errorf("%w: %s", ErrUnknownGroup, groupKey)
	}

	indexes := make(map[string]int, len(catalogDefinitions))
	for index, definition := range catalogDefinitions {
		indexes[definition.Key] = index
	}
	selected := make([]bool, len(catalogDefinitions))
	for _, value := range values {
		index, ok := indexes[value]
		if !ok {
			return nil, fmt.Errorf("%w: %s", ErrUnknownPermission, value)
		}
		if selected[index] {
			return nil, fmt.Errorf("%w: %s", ErrDuplicatePermission, value)
		}
		selected[index] = true
	}

	switch groupKey {
	case GroupGuest:
		if len(values) != 0 {
			return nil, ErrProtectedPermission
		}
	case GroupUser:
		for index, definition := range catalogDefinitions {
			if definition.Protected && selected[index] {
				return nil, fmt.Errorf("%w: %s", ErrProtectedPermission, definition.Key)
			}
		}
	case GroupAdmin:
		for index, definition := range catalogDefinitions {
			if definition.Protected && !selected[index] {
				return nil, fmt.Errorf("%w: %s", ErrProtectedPermission, definition.Key)
			}
		}
	}

	result := make([]string, 0, len(values))
	for index, definition := range catalogDefinitions {
		if selected[index] {
			result = append(result, definition.Key)
		}
	}
	return result, nil
}

// validateCatalog compares supplied values with the fixed catalog contract.
func validateCatalog(definitions []Definition, presets []Preset) error {
	wantDefinitions := expectedDefinitions()
	if len(definitions) != len(wantDefinitions) {
		return fmt.Errorf("permission definitions length = %d, want %d", len(definitions), len(wantDefinitions))
	}
	for index, definition := range definitions {
		if definition != wantDefinitions[index] {
			return fmt.Errorf("permission definition %d = %#v, want %#v", index, definition, wantDefinitions[index])
		}
	}

	wantPresets := expectedPresets()
	if len(presets) != len(wantPresets) {
		return fmt.Errorf("permission presets length = %d, want %d", len(presets), len(wantPresets))
	}
	for index, preset := range presets {
		want := wantPresets[index]
		if preset.Key != want.Key {
			return fmt.Errorf("permission preset %d key = %q, want %q", index, preset.Key, want.Key)
		}
		if !equalStrings(preset.ApplicableGroups, want.ApplicableGroups) {
			return fmt.Errorf("permission preset %q applicable groups = %#v, want %#v", preset.Key, preset.ApplicableGroups, want.ApplicableGroups)
		}
		if !equalStrings(preset.Permissions, want.Permissions) {
			return fmt.Errorf("permission preset %q permissions = %#v, want %#v", preset.Key, preset.Permissions, want.Permissions)
		}
	}
	return nil
}

// expectedDefinitions constructs the canonical catalog without exposing mutable state.
func expectedDefinitions() []Definition {
	return []Definition{
		{Key: ShortLinkCreate, Category: "short_link_basic"},
		{Key: ShortLinkReadOwn, Category: "short_link_basic"},
		{Key: ShortLinkUpdateOwn, Category: "short_link_basic"},
		{Key: ShortLinkDeleteOwn, Category: "short_link_basic"},
		{Key: ShortLinkUseIntermediate, Category: "short_link_access"},
		{Key: ShortLinkSetExpiration, Category: "short_link_access"},
		{Key: ShortLinkSetPassword, Category: "short_link_access"},
		{Key: ShortLinkUseConfirmation, Category: "short_link_access"},
		{Key: DomainUseDefault, Category: "domain"},
		{Key: AdminAccess, Category: "administration", Protected: true},
		{Key: ShortLinkReadAll, Category: "administration", Protected: true},
		{Key: ShortLinkUpdateAll, Category: "administration", Protected: true},
		{Key: ShortLinkDeleteAll, Category: "administration", Protected: true},
	}
}

// expectedPresets constructs the canonical presets without exposing mutable state.
func expectedPresets() []Preset {
	return []Preset{
		{Key: "restricted", ApplicableGroups: []string{GroupUser, GroupAdmin}, Permissions: []string{}},
		{
			Key:              "basic",
			ApplicableGroups: []string{GroupUser, GroupAdmin},
			Permissions: []string{
				ShortLinkCreate,
				ShortLinkReadOwn,
				ShortLinkUpdateOwn,
				ShortLinkDeleteOwn,
				DomainUseDefault,
			},
		},
		{
			Key:              "standard",
			ApplicableGroups: []string{GroupUser, GroupAdmin},
			Permissions: []string{
				ShortLinkCreate,
				ShortLinkReadOwn,
				ShortLinkUpdateOwn,
				ShortLinkDeleteOwn,
				ShortLinkUseIntermediate,
				ShortLinkSetExpiration,
				ShortLinkSetPassword,
				ShortLinkUseConfirmation,
				DomainUseDefault,
			},
		},
	}
}

// cloneStrings returns an independent slice while preserving empty non-nil slices.
func cloneStrings(values []string) []string {
	result := make([]string, len(values))
	copy(result, values)
	return result
}

// equalStrings reports whether two string slices have identical ordered values.
func equalStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
