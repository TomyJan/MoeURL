package shortlink

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TagCatalogInput searches existing tags without accepting a client-owned scope or limit.
type TagCatalogInput struct{ Query string }

// TagCatalogItem counts distinct non-deleted links within the endpoint's authorized scope.
type TagCatalogItem struct {
	Tag       string `json:"tag"`
	LinkCount int64  `json:"linkCount"`
}

// TagCatalogResult explicitly identifies a bounded directory that may have further matches.
type TagCatalogResult struct {
	Items   []TagCatalogItem `json:"items"`
	HasMore bool             `json:"hasMore"`
}

// ListTags reads tags and current database authorization in one bounded SELECT snapshot.
func (s *Service) ListTags(ctx context.Context, user auth.CurrentUser, input TagCatalogInput) (TagCatalogResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	query := strings.TrimSpace(input.Query)
	if !utf8.ValidString(input.Query) || containsControl(input.Query) || utf8.RuneCountInString(query) > 32 {
		return TagCatalogResult{}, ErrInvalidInput
	}
	actorID, err := uuid.Parse(user.ID)
	if err != nil || actorID == uuid.Nil || actorID.String() != user.ID {
		return TagCatalogResult{}, ErrPermissionDenied
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return TagCatalogResult{}, err
	}
	defer tx.Rollback(ctx)
	grants, err := permission.ResolveForAccountIn(ctx, tx, s.permissions, user.ID, user.GroupKey)
	if err != nil {
		return TagCatalogResult{}, err
	}
	if !grants.Has(permission.ShortLinkReadOwn) {
		return TagCatalogResult{}, ErrPermissionDenied
	}
	rows, err := s.queries.WithTx(tx).ListPersonalTagCatalog(ctx, sqlc.ListPersonalTagCatalogParams{ActorID: uuidToPgtype(actorID), Query: query, PermissionGranted: true})
	if err != nil {
		return TagCatalogResult{}, err
	}
	if len(rows) == 0 || !rows[0].Allowed {
		return TagCatalogResult{}, ErrPermissionDenied
	}
	if err := tx.Commit(ctx); err != nil {
		return TagCatalogResult{}, err
	}
	result := TagCatalogResult{Items: make([]TagCatalogItem, 0, len(rows)), HasMore: len(rows) > 50}
	if result.HasMore {
		rows = rows[:50]
	}
	for _, row := range rows {
		if row.Tag != "" {
			result.Items = append(result.Items, TagCatalogItem{Tag: row.Tag, LinkCount: row.LinkCount})
		}
	}
	return result, nil
}
