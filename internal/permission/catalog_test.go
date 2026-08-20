package permission

import (
	"errors"
	"reflect"
	"testing"
)

// TestCatalogDefinitionsCoverPermissionConstants verifies the catalog is complete, unique, and stable.
func TestCatalogDefinitionsCoverPermissionConstants(t *testing.T) {
	want := []Definition{
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

	definitions := Definitions()
	if !reflect.DeepEqual(definitions, want) {
		t.Fatalf("definitions = %#v, want %#v", definitions, want)
	}
	if !reflect.DeepEqual(CatalogKeys(), definitionKeys(want)) {
		t.Fatalf("catalog keys = %#v, want %#v", CatalogKeys(), definitionKeys(want))
	}
	if err := ValidateCatalog(); err != nil {
		t.Fatalf("validate catalog: %v", err)
	}
}

// TestCatalogAccessorsReturnIndependentCopies verifies callers cannot mutate package catalog state.
func TestCatalogAccessorsReturnIndependentCopies(t *testing.T) {
	definitions := Definitions()
	definitions[0].Key = "mutated"
	if Definitions()[0].Key == "mutated" {
		t.Fatal("Definitions exposed mutable package state")
	}

	keys := CatalogKeys()
	keys[0] = "mutated"
	if CatalogKeys()[0] == "mutated" {
		t.Fatal("CatalogKeys exposed mutable package state")
	}

	presets := Presets()
	presets[0].ApplicableGroups[0] = "mutated"
	presets[1].Permissions[0] = "mutated"
	fresh := Presets()
	if fresh[0].ApplicableGroups[0] == "mutated" || fresh[1].Permissions[0] == "mutated" {
		t.Fatal("Presets exposed mutable package state")
	}
}

// TestPresetDefinitions verifies the three presets contain only configurable permissions.
func TestPresetDefinitions(t *testing.T) {
	want := []Preset{
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
		{Key: "standard", ApplicableGroups: []string{GroupUser, GroupAdmin}, Permissions: append([]string(nil), UserPermissions...)},
	}

	if got := Presets(); !reflect.DeepEqual(got, want) {
		t.Fatalf("presets = %#v, want %#v", got, want)
	}
	for _, preset := range Presets() {
		for _, key := range preset.Permissions {
			definition := findDefinition(t, key)
			if definition.Protected {
				t.Fatalf("preset %q contains protected permission %q", preset.Key, key)
			}
		}
	}
}

// TestProtectedPermissionNormalization verifies protected permissions retain their fixed ownership.
func TestProtectedPermissionNormalization(t *testing.T) {
	adminInput := []string{
		ShortLinkDeleteAll,
		ShortLinkCreate,
		ShortLinkReadAll,
		AdminAccess,
		ShortLinkUpdateAll,
	}
	wantAdmin := []string{
		ShortLinkCreate,
		AdminAccess,
		ShortLinkReadAll,
		ShortLinkUpdateAll,
		ShortLinkDeleteAll,
	}
	admin, err := NormalizeForGroup(GroupAdmin, adminInput)
	if err != nil {
		t.Fatalf("normalize admin permissions: %v", err)
	}
	if !reflect.DeepEqual(admin, wantAdmin) {
		t.Fatalf("admin permissions = %#v, want %#v", admin, wantAdmin)
	}

	tests := []struct {
		name   string
		group  string
		values []string
		want   error
	}{
		{name: "guest empty", group: GroupGuest, values: nil},
		{name: "guest permission", group: GroupGuest, values: []string{ShortLinkCreate}, want: ErrProtectedPermission},
		{name: "user configurable", group: GroupUser, values: []string{DomainUseDefault, ShortLinkCreate}},
		{name: "user protected", group: GroupUser, values: []string{AdminAccess}, want: ErrProtectedPermission},
		{name: "admin missing protected", group: GroupAdmin, values: []string{ShortLinkCreate}, want: ErrProtectedPermission},
		{name: "unknown group", group: "custom", values: nil, want: ErrUnknownGroup},
		{name: "unknown permission", group: GroupUser, values: []string{"short_link:unknown"}, want: ErrUnknownPermission},
		{name: "duplicate permission", group: GroupUser, values: []string{ShortLinkCreate, ShortLinkCreate}, want: ErrDuplicatePermission},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeForGroup(test.group, test.values)
			if !errors.Is(err, test.want) {
				t.Fatalf("NormalizeForGroup() error = %v, want %v", err, test.want)
			}
			if err == nil {
				want := normalizedKeys(test.group, test.values)
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("NormalizeForGroup() = %#v, want %#v", got, want)
				}
				if len(got) > 0 {
					got[0] = "mutated"
					fresh, freshErr := NormalizeForGroup(test.group, test.values)
					if freshErr != nil || fresh[0] == "mutated" {
						t.Fatalf("NormalizeForGroup exposed mutable state: %v, %#v", freshErr, fresh)
					}
				}
			}
		})
	}
}

// TestCatalogValidationRejectsInvalidDefinitionsAndPresets verifies static catalog self-check failures.
func TestCatalogValidationRejectsInvalidDefinitionsAndPresets(t *testing.T) {
	validDefinitions := Definitions()
	validPresets := Presets()
	tests := []struct {
		name        string
		definitions []Definition
		presets     []Preset
	}{
		{name: "missing definition", definitions: validDefinitions[:len(validDefinitions)-1], presets: validPresets},
		{name: "unexpected definition key", definitions: replaceDefinition(validDefinitions, 0, Definition{Key: "unknown", Category: "short_link_basic"}), presets: validPresets},
		{name: "duplicate definition", definitions: replaceDefinition(validDefinitions, 1, validDefinitions[0]), presets: validPresets},
		{name: "wrong category", definitions: replaceDefinition(validDefinitions, 0, Definition{Key: ShortLinkCreate, Category: "wrong"}), presets: validPresets},
		{name: "wrong protection", definitions: replaceDefinition(validDefinitions, 0, Definition{Key: ShortLinkCreate, Category: "short_link_basic", Protected: true}), presets: validPresets},
		{name: "missing preset", definitions: validDefinitions, presets: validPresets[:len(validPresets)-1]},
		{name: "wrong preset key", definitions: validDefinitions, presets: replacePreset(validPresets, 0, Preset{Key: "unknown", ApplicableGroups: []string{GroupUser, GroupAdmin}})},
		{name: "wrong applicable groups", definitions: validDefinitions, presets: replacePreset(validPresets, 0, Preset{Key: "restricted", ApplicableGroups: []string{GroupGuest, GroupAdmin}})},
		{name: "unknown preset permission", definitions: validDefinitions, presets: replacePreset(validPresets, 1, Preset{Key: "basic", ApplicableGroups: []string{GroupUser, GroupAdmin}, Permissions: []string{"unknown"}})},
		{name: "duplicate preset permission", definitions: validDefinitions, presets: replacePreset(validPresets, 1, Preset{Key: "basic", ApplicableGroups: []string{GroupUser, GroupAdmin}, Permissions: []string{ShortLinkCreate, ShortLinkCreate}})},
		{name: "protected preset permission", definitions: validDefinitions, presets: replacePreset(validPresets, 1, Preset{Key: "basic", ApplicableGroups: []string{GroupUser, GroupAdmin}, Permissions: []string{AdminAccess}})},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateCatalog(test.definitions, test.presets); err == nil {
				t.Fatal("expected catalog validation error")
			}
		})
	}
}

// definitionKeys returns keys in definition order for the surrounding assertions.
func definitionKeys(definitions []Definition) []string {
	keys := make([]string, len(definitions))
	for index, definition := range definitions {
		keys[index] = definition.Key
	}
	return keys
}

// findDefinition returns a catalog definition by key for the surrounding assertions.
func findDefinition(t *testing.T, key string) Definition {
	t.Helper()
	for _, definition := range Definitions() {
		if definition.Key == key {
			return definition
		}
	}
	t.Fatalf("definition %q not found", key)
	return Definition{}
}

// normalizedKeys returns the expected stable subset for successful test cases.
func normalizedKeys(group string, values []string) []string {
	selected := make(map[string]struct{}, len(values))
	for _, value := range values {
		selected[value] = struct{}{}
	}
	result := []string{}
	for _, definition := range Definitions() {
		if _, ok := selected[definition.Key]; ok {
			result = append(result, definition.Key)
		}
	}
	return result
}

// replaceDefinition returns a copied definition list with one replacement.
func replaceDefinition(values []Definition, index int, value Definition) []Definition {
	result := append([]Definition(nil), values...)
	result[index] = value
	return result
}

// replacePreset returns a deeply copied preset list with one replacement.
func replacePreset(values []Preset, index int, value Preset) []Preset {
	result := make([]Preset, len(values))
	for current, preset := range values {
		result[current] = Preset{
			Key:              preset.Key,
			ApplicableGroups: append([]string(nil), preset.ApplicableGroups...),
			Permissions:      append([]string(nil), preset.Permissions...),
		}
	}
	result[index] = value
	return result
}
