package insights

import (
	"context"
	"github.com/TomyJan/MoeURL/internal/auth"
	"time"
)

// AuditPort keeps audit reads independent of the dashboard/visit handler contract.
type AuditPort interface {
	Audit(context.Context, auth.CurrentUser, AuditInput) (AuditResult, error)
}

type AuditInput struct {
	RangeInput
	ActorID, ResourceType, Action, Cursor string
	PageSize                              int32
}

type AuditItem struct {
	ID            string    `json:"id"`
	ActorID       *string   `json:"actorId"`
	ActorUsername *string   `json:"actorUsername"`
	ResourceType  string    `json:"resourceType"`
	ResourceID    string    `json:"resourceId"`
	Action        string    `json:"action"`
	ChangedFields []string  `json:"changedFields"`
	OccurredAt    time.Time `json:"occurredAt"`
}

type AuditResult struct {
	Items         []AuditItem `json:"items"`
	Range         Range       `json:"range"`
	PageSize      int32       `json:"pageSize"`
	HasMore       bool        `json:"hasMore"`
	NextCursor    string      `json:"nextCursor"`
	RetentionDays int         `json:"retentionDays"`
}
