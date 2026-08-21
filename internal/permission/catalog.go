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

var catalogDefinitions = newCatalogDefinitions()
var catalogPresets = newCatalogPresets()

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

// validateCatalog verifies catalog structure against the active authorization baselines.
func validateCatalog(definitions []Definition, presets []Preset) error {
	definitionKeys := make(map[string]struct{}, len(definitions))
	definitionByKey := make(map[string]Definition, len(definitions))
	for _, definition := range definitions {
		if _, exists := definitionKeys[definition.Key]; exists {
			return fmt.Errorf("duplicate permission definition: %s", definition.Key)
		}
		if !validCategory(definition.Category) {
			return fmt.Errorf("invalid permission category for %s: %s", definition.Key, definition.Category)
		}
		definitionKeys[definition.Key] = struct{}{}
		definitionByKey[definition.Key] = definition
	}

	adminKeys, err := uniqueStringSet("admin permission baseline", AdminPermissions)
	if err != nil {
		return err
	}
	if !equalStringSets(definitionKeys, adminKeys) {
		return fmt.Errorf("permission definitions do not match admin permission baseline")
	}

	protectedKeys := map[string]struct{}{
		AdminAccess:        {},
		ShortLinkReadAll:   {},
		ShortLinkUpdateAll: {},
		ShortLinkDeleteAll: {},
	}
	configurableKeys := make(map[string]struct{}, len(definitions)-len(protectedKeys))
	for _, definition := range definitions {
		_, protected := protectedKeys[definition.Key]
		if definition.Protected != protected {
			return fmt.Errorf("invalid protected state for permission: %s", definition.Key)
		}
		if !protected {
			configurableKeys[definition.Key] = struct{}{}
		}
	}

	userKeys, err := uniqueStringSet("user permission baseline", UserPermissions)
	if err != nil {
		return err
	}
	if !equalStringSets(configurableKeys, userKeys) {
		return fmt.Errorf("configurable permissions do not match user permission baseline")
	}

	requiredPresetKeys := map[string]struct{}{"restricted": {}, "basic": {}, "standard": {}}
	requiredGroups := map[string]struct{}{GroupUser: {}, GroupAdmin: {}}
	presetKeys := make(map[string]struct{}, len(presets))
	for _, preset := range presets {
		if _, exists := presetKeys[preset.Key]; exists {
			return fmt.Errorf("duplicate permission preset: %s", preset.Key)
		}
		if _, required := requiredPresetKeys[preset.Key]; !required {
			return fmt.Errorf("unknown permission preset: %s", preset.Key)
		}
		presetKeys[preset.Key] = struct{}{}

		groups, err := uniqueStringSet("preset applicable groups", preset.ApplicableGroups)
		if err != nil {
			return fmt.Errorf("preset %s: %w", preset.Key, err)
		}
		if !equalStringSets(groups, requiredGroups) {
			return fmt.Errorf("preset %s must apply to user and admin", preset.Key)
		}

		permissions, err := uniqueStringSet("preset permissions", preset.Permissions)
		if err != nil {
			return fmt.Errorf("preset %s: %w", preset.Key, err)
		}
		for permissionKey := range permissions {
			definition, exists := definitionByKey[permissionKey]
			if !exists {
				return fmt.Errorf("preset %s contains unknown permission: %s", preset.Key, permissionKey)
			}
			if definition.Protected {
				return fmt.Errorf("preset %s contains protected permission: %s", preset.Key, permissionKey)
			}
		}
		if preset.Key == "restricted" && len(permissions) != 0 {
			return fmt.Errorf("restricted preset must not contain permissions")
		}
		if preset.Key == "standard" && !equalStringSets(permissions, userKeys) {
			return fmt.Errorf("standard preset does not match user permission baseline")
		}
	}
	if !equalStringSets(presetKeys, requiredPresetKeys) {
		return fmt.Errorf("permission presets are incomplete")
	}
	return nil
}

// validCategory reports whether a category belongs to the public catalog contract.
func validCategory(category string) bool {
	switch category {
	case "short_link_basic", "short_link_access", "domain", "administration":
		return true
	default:
		return false
	}
}

// uniqueStringSet converts unique values into a set or reports a duplicate.
func uniqueStringSet(subject string, values []string) (map[string]struct{}, error) {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		if _, exists := result[value]; exists {
			return nil, fmt.Errorf("duplicate %s value: %s", subject, value)
		}
		result[value] = struct{}{}
	}
	return result, nil
}

// equalStringSets reports whether two sets contain exactly the same keys.
func equalStringSets(left map[string]struct{}, right map[string]struct{}) bool {
	if len(left) != len(right) {
		return false
	}
	for value := range left {
		if _, exists := right[value]; !exists {
			return false
		}
	}
	return true
}

// newCatalogDefinitions constructs the package catalog without exposing mutable state.
func newCatalogDefinitions() []Definition {
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

// newCatalogPresets constructs the package presets without exposing mutable state.
func newCatalogPresets() []Preset {
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
