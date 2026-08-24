package usergroup

import "github.com/TomyJan/MoeURL/internal/permission"

// UserGroup is the public representation of a built-in user group.
type UserGroup struct {
	Key         string   `json:"key"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Builtin     bool     `json:"builtin"`
	Editable    bool     `json:"editable"`
	Permissions []string `json:"permissions"`
	UpdatedAt   string   `json:"updatedAt"`
}

// ListResult contains built-in groups and the stable permission catalog.
type ListResult struct {
	Groups      []UserGroup             `json:"groups"`
	Permissions []permission.Definition `json:"permissions"`
	Presets     []permission.Preset     `json:"presets"`
}

// UpdatePermissionsInput describes one optimistic permission update.
type UpdatePermissionsInput struct {
	GroupKey          string   `json:"groupKey"`
	Permissions       []string `json:"permissions"`
	ExpectedUpdatedAt string   `json:"expectedUpdatedAt"`
}

// UpdatePermissionsResult contains the updated group.
type UpdatePermissionsResult struct {
	Group UserGroup `json:"group"`
}
