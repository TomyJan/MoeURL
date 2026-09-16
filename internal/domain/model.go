package domain

import "errors"

var (
	ErrPermissionDenied = errors.New("domain permission denied")
	ErrInvalidInput     = errors.New("invalid domain input")
	ErrDomainConflict   = errors.New("domain authority conflict")
	ErrDomainNotFound   = errors.New("domain not found")
	ErrVersionConflict  = errors.New("domain version conflict")
	ErrDomainReferenced = errors.New("domain has short links")
	ErrDomainProtected  = errors.New("default domain must remain enabled")
)

// Domain is one managed short-link domain with its group grants and reference status.
type Domain struct {
	ID            string   `json:"id"`
	Host          string   `json:"host"`
	DisplayName   string   `json:"displayName"`
	Purpose       string   `json:"purpose"`
	Enabled       bool     `json:"enabled"`
	IsDefault     bool     `json:"isDefault"`
	AllowedGroups []string `json:"allowedGroups"`
	Referenced    bool     `json:"referenced"`
	UpdatedAt     string   `json:"updatedAt"`
}

// AvailableDomain is a domain offered to the current user for short-link creation.
type AvailableDomain struct {
	ID          string `json:"id"`
	Host        string `json:"host"`
	DisplayName string `json:"displayName"`
	IsDefault   bool   `json:"isDefault"`
}

type ListResult struct {
	Items []Domain `json:"items"`
}

type AvailableResult struct {
	Items []AvailableDomain `json:"items"`
}

type CreateInput struct {
	Host          string   `json:"host"`
	DisplayName   string   `json:"displayName"`
	AllowedGroups []string `json:"allowedGroups"`
	Enabled       bool     `json:"enabled"`
}

type UpdateInput struct {
	ID                string   `json:"id"`
	Host              string   `json:"host"`
	DisplayName       string   `json:"displayName"`
	AllowedGroups     []string `json:"allowedGroups"`
	Enabled           bool     `json:"enabled"`
	ExpectedUpdatedAt string   `json:"expectedUpdatedAt"`
}

type ChangeInput struct {
	ID                string `json:"id"`
	ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
}
