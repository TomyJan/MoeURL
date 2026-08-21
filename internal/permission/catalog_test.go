package permission

import (
	"errors"
	"reflect"
	"slices"
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
				want := normalizedKeys(test.values)
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

// TestCatalogValidationRejectsStructuralViolations verifies each catalog invariant independently.
func TestCatalogValidationRejectsStructuralViolations(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*[]Definition, *[]Preset)
	}{
		{name: "missing catalog key", mutate: func(definitions *[]Definition, _ *[]Preset) {
			*definitions = (*definitions)[:len(*definitions)-1]
		}},
		{name: "unknown catalog key", mutate: func(definitions *[]Definition, _ *[]Preset) {
			(*definitions)[0].Key = "unknown"
		}},
		{name: "duplicate catalog key", mutate: func(definitions *[]Definition, _ *[]Preset) {
			(*definitions)[1].Key = (*definitions)[0].Key
		}},
		{name: "empty category", mutate: func(definitions *[]Definition, _ *[]Preset) {
			(*definitions)[0].Category = ""
		}},
		{name: "unknown category", mutate: func(definitions *[]Definition, _ *[]Preset) {
			(*definitions)[0].Category = "unknown"
		}},
		{name: "missing protected permission", mutate: func(definitions *[]Definition, _ *[]Preset) {
			for index, definition := range *definitions {
				if definition.Key == AdminAccess {
					(*definitions)[index].Protected = false
					return
				}
			}
		}},
		{name: "extra protected permission", mutate: func(definitions *[]Definition, _ *[]Preset) {
			(*definitions)[0].Protected = true
		}},
		{name: "missing preset key", mutate: func(_ *[]Definition, presets *[]Preset) {
			*presets = (*presets)[:len(*presets)-1]
		}},
		{name: "unknown preset key", mutate: func(_ *[]Definition, presets *[]Preset) {
			(*presets)[0].Key = "unknown"
		}},
		{name: "duplicate preset key", mutate: func(_ *[]Definition, presets *[]Preset) {
			(*presets)[1].Key = (*presets)[0].Key
		}},
		{name: "missing applicable group", mutate: func(_ *[]Definition, presets *[]Preset) {
			(*presets)[0].ApplicableGroups = []string{GroupUser}
		}},
		{name: "duplicate applicable group", mutate: func(_ *[]Definition, presets *[]Preset) {
			(*presets)[0].ApplicableGroups = []string{GroupUser, GroupUser}
		}},
		{name: "unexpected applicable group", mutate: func(_ *[]Definition, presets *[]Preset) {
			(*presets)[0].ApplicableGroups = []string{GroupUser, GroupGuest}
		}},
		{name: "restricted permission", mutate: func(_ *[]Definition, presets *[]Preset) {
			(*presets)[0].Permissions = []string{ShortLinkCreate}
		}},
		{name: "unknown preset permission", mutate: func(_ *[]Definition, presets *[]Preset) {
			(*presets)[1].Permissions = []string{"unknown"}
		}},
		{name: "duplicate preset permission", mutate: func(_ *[]Definition, presets *[]Preset) {
			(*presets)[1].Permissions = []string{ShortLinkCreate, ShortLinkCreate}
		}},
		{name: "protected preset permission", mutate: func(_ *[]Definition, presets *[]Preset) {
			(*presets)[1].Permissions = []string{AdminAccess}
		}},
		{name: "standard differs from user baseline", mutate: func(_ *[]Definition, presets *[]Preset) {
			(*presets)[2].Permissions = (*presets)[2].Permissions[:len((*presets)[2].Permissions)-1]
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			definitions := Definitions()
			presets := Presets()
			test.mutate(&definitions, &presets)
			if err := validateCatalog(definitions, presets); err == nil {
				t.Fatal("expected catalog validation error")
			}
		})
	}
}

// TestCatalogValidationUsesAuthorizationBaselines verifies catalog integrity follows real grant baselines.
func TestCatalogValidationUsesAuthorizationBaselines(t *testing.T) {
	tests := []struct {
		name   string
		mutate func()
	}{
		{name: "admin missing permission", mutate: func() { AdminPermissions = AdminPermissions[:len(AdminPermissions)-1] }},
		{name: "admin duplicate permission", mutate: func() { AdminPermissions = append(AdminPermissions, AdminPermissions[0]) }},
		{name: "admin unknown permission", mutate: func() { AdminPermissions = append(AdminPermissions, "unknown") }},
		{name: "user missing permission", mutate: func() { UserPermissions = UserPermissions[:len(UserPermissions)-1] }},
		{name: "user duplicate permission", mutate: func() { UserPermissions = append(UserPermissions, UserPermissions[0]) }},
		{name: "user protected permission", mutate: func() { UserPermissions = append(UserPermissions, AdminAccess) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			originalUser := UserPermissions
			originalAdmin := AdminPermissions
			UserPermissions = slices.Clone(UserPermissions)
			AdminPermissions = slices.Clone(AdminPermissions)
			defer func() {
				UserPermissions = originalUser
				AdminPermissions = originalAdmin
			}()

			test.mutate()
			if err := validateCatalog(Definitions(), Presets()); err == nil {
				t.Fatal("expected authorization baseline validation error")
			}
		})
	}
}

// TestCatalogValidationTreatsSetsAsOrderIndependent verifies structural checks do not rely on slice order.
func TestCatalogValidationTreatsSetsAsOrderIndependent(t *testing.T) {
	originalUser := UserPermissions
	originalAdmin := AdminPermissions
	UserPermissions = slices.Clone(UserPermissions)
	AdminPermissions = slices.Clone(AdminPermissions)
	defer func() {
		UserPermissions = originalUser
		AdminPermissions = originalAdmin
	}()
	slices.Reverse(UserPermissions)
	slices.Reverse(AdminPermissions)

	presets := Presets()
	for index := range presets {
		slices.Reverse(presets[index].ApplicableGroups)
	}
	slices.Reverse(presets[2].Permissions)
	if err := validateCatalog(Definitions(), presets); err != nil {
		t.Fatalf("validate reordered catalog sets: %v", err)
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
func normalizedKeys(values []string) []string {
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
