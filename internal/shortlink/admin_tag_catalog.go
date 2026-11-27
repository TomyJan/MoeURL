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

// ListAdminTags reads a bounded global directory and current management grants in one SELECT snapshot.
func (s *Service) ListAdminTags(ctx context.Context, user auth.CurrentUser, input TagCatalogInput) (TagCatalogResult, error) {
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
	if !grants.Has(permission.AdminAccess) || !grants.Has(permission.ShortLinkReadAll) {
		return TagCatalogResult{}, ErrPermissionDenied
	}
	rows, err := s.queries.WithTx(tx).ListAdminTagCatalog(ctx, sqlc.ListAdminTagCatalogParams{Query: query, PermissionGranted: true})
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
