package domain

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const domainWriteLockKey int64 = 0x6d6f6575726c444d

// Service manages short-link domains, group assignments, and the global default.
type Service struct {
	pool              *pgxpool.Pool
	queries           *sqlc.Queries
	permissions       permission.Resolver
	allowLoopbackHTTP bool
}

// NewService uses production Origin validation by default.
func NewService(pool *pgxpool.Pool, permissions permission.Resolver) *Service {
	return NewServiceWithDevelopment(pool, permissions, false)
}

// NewServiceWithDevelopment explicitly permits loopback HTTP in development.
func NewServiceWithDevelopment(pool *pgxpool.Pool, permissions permission.Resolver, allowLoopbackHTTP bool) *Service {
	return &Service{pool: pool, queries: sqlc.New(pool), permissions: permissions, allowLoopbackHTTP: allowLoopbackHTTP}
}

// List returns every managed domain with its built-in group grants.
func (s *Service) List(ctx context.Context, actor auth.CurrentUser) (ListResult, error) {
	if err := s.authorizeAdmin(ctx, actor); err != nil {
		return ListResult{}, err
	}
	rows, err := s.queries.ListManagedDomains(ctx)
	if err != nil {
		return ListResult{}, err
	}
	result := ListResult{Items: make([]Domain, 0, len(rows))}
	for _, row := range rows {
		grants, err := s.queries.ListDomainGrantKeys(ctx, row.ID)
		if err != nil {
			return ListResult{}, err
		}
		result.Items = append(result.Items, Domain{
			ID: uuid.UUID(row.ID.Bytes).String(), Host: row.Host, DisplayName: row.DisplayName,
			Purpose: row.Purpose, Enabled: row.Enabled, IsDefault: row.IsDefault,
			AllowedGroups: grants, Referenced: row.Referenced, UpdatedAt: formatUpdatedAt(row.UpdatedAt),
		})
	}
	return result, nil
}

// Available returns the permission-and-group-grant intersection for an authenticated user.
func (s *Service) Available(ctx context.Context, actor auth.CurrentUser) (AvailableResult, error) {
	result := AvailableResult{Items: []AvailableDomain{}}
	if actor.ID == "" || actor.GroupKey == permission.GroupGuest {
		return result, ErrPermissionDenied
	}
	if s.permissions == nil {
		return result, ErrPermissionDenied
	}
	snapshot, err := s.permissions.Resolve(ctx, actor.GroupKey)
	if err != nil {
		return result, err
	}
	if !snapshot.Has(permission.ShortLinkCreate) {
		return result, nil
	}
	rows, err := s.queries.ListAvailableShortLinkDomains(ctx, sqlc.ListAvailableShortLinkDomainsParams{
		GroupKey: actor.GroupKey, CanDefault: snapshot.Has(permission.DomainUseDefault),
		CanAssigned: snapshot.Has(permission.DomainUseAssigned),
	})
	if err != nil {
		return result, err
	}
	for _, row := range rows {
		result.Items = append(result.Items, AvailableDomain{
			ID: uuid.UUID(row.ID.Bytes).String(), Host: row.Host,
			DisplayName: row.DisplayName, IsDefault: row.IsDefault,
		})
	}
	return result, nil
}

// Create registers a unique authority and grants it to selected built-in groups.
func (s *Service) Create(ctx context.Context, actor auth.CurrentUser, input CreateInput) (Domain, error) {
	if err := s.authorizeAdmin(ctx, actor); err != nil {
		return Domain{}, err
	}
	host, displayName, groups, err := s.validateInput(input.Host, input.DisplayName, input.AllowedGroups)
	if err != nil {
		return Domain{}, err
	}
	var created Domain
	err = appdb.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockDomainWrites(ctx, tx); err != nil {
			return err
		}
		q := s.queries.WithTx(tx)
		if err := checkAuthorityConflict(ctx, q, host, uuid.Nil); err != nil {
			return err
		}
		row, err := q.CreateDomain(ctx, sqlc.CreateDomainParams{
			ID: pgUUID(uuid.New()), Host: host, DisplayName: displayName,
			Purpose: "short_link", Enabled: input.Enabled, IsDefault: false,
		})
		if err != nil {
			return mapUniqueConflict(err)
		}
		if err := replaceGrants(ctx, q, row.ID, groups); err != nil {
			return err
		}
		created = domainFromRow(row, groups, false)
		return nil
	})
	return created, err
}

// Update changes only an unreferenced address and never disables the current default.
func (s *Service) Update(ctx context.Context, actor auth.CurrentUser, input UpdateInput) (Domain, error) {
	if err := s.authorizeAdmin(ctx, actor); err != nil {
		return Domain{}, err
	}
	id, expected, err := parseChange(input.ID, input.ExpectedUpdatedAt)
	if err != nil {
		return Domain{}, err
	}
	var updated Domain
	err = appdb.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockDomainWrites(ctx, tx); err != nil {
			return err
		}
		q := s.queries.WithTx(tx)
		current, err := q.GetManagedDomainForUpdate(ctx, pgUUID(id))
		if err != nil {
			return mapNotFound(err)
		}
		if !current.UpdatedAt.Time.Equal(expected) {
			return ErrVersionConflict
		}
		host := current.Host
		if input.Host != current.Host {
			host, err = NormalizeOrigin(input.Host, s.allowLoopbackHTTP)
			if err != nil {
				return ErrInvalidInput
			}
		}
		displayName, groups, err := validateNameAndGroups(input.DisplayName, input.AllowedGroups)
		if err != nil {
			return err
		}
		if current.IsDefault && !input.Enabled {
			return ErrDomainProtected
		}
		referenced, err := q.DomainHasReferences(ctx, current.ID)
		if err != nil {
			return err
		}
		if referenced && current.Host != host {
			return ErrDomainReferenced
		}
		if err := checkAuthorityConflict(ctx, q, host, id); err != nil {
			return err
		}
		row, err := q.UpdateManagedDomain(ctx, sqlc.UpdateManagedDomainParams{
			ID: current.ID, Host: host, DisplayName: displayName, Enabled: input.Enabled,
			UpdatedAt: current.UpdatedAt,
		})
		if err != nil {
			return mapUniqueConflict(mapNotFound(err))
		}
		if err := replaceGrants(ctx, q, row.ID, groups); err != nil {
			return err
		}
		if row.IsDefault {
			if err := syncDefaultHostSetting(ctx, q, row.Host); err != nil {
				return err
			}
		}
		updated = domainFromRow(row, groups, referenced)
		return nil
	})
	return updated, err
}

// SetDefault switches the unique default and its legacy setting mirror in one transaction.
func (s *Service) SetDefault(ctx context.Context, actor auth.CurrentUser, input ChangeInput) (Domain, error) {
	if err := s.authorizeAdmin(ctx, actor); err != nil {
		return Domain{}, err
	}
	id, expected, err := parseChange(input.ID, input.ExpectedUpdatedAt)
	if err != nil {
		return Domain{}, err
	}
	var selected Domain
	err = appdb.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockDomainWrites(ctx, tx); err != nil {
			return err
		}
		q := s.queries.WithTx(tx)
		current, err := q.GetManagedDomainForUpdate(ctx, pgUUID(id))
		if err != nil {
			return mapNotFound(err)
		}
		if !current.UpdatedAt.Time.Equal(expected) {
			return ErrVersionConflict
		}
		if !current.Enabled {
			return ErrDomainProtected
		}
		if !current.IsDefault {
			if err := q.ClearDefaultShortLinkDomain(ctx); err != nil {
				return err
			}
		}
		current, err = q.MakeDefaultShortLinkDomain(ctx, sqlc.MakeDefaultShortLinkDomainParams{ID: current.ID, UpdatedAt: current.UpdatedAt})
		if err != nil {
			return mapNotFound(err)
		}
		if err := syncDefaultHostSetting(ctx, q, current.Host); err != nil {
			return err
		}
		groups, err := q.ListDomainGrantKeys(ctx, current.ID)
		if err != nil {
			return err
		}
		referenced, err := q.DomainHasReferences(ctx, current.ID)
		if err != nil {
			return err
		}
		selected = domainFromRow(current, groups, referenced)
		return nil
	})
	return selected, err
}

func syncDefaultHostSetting(ctx context.Context, q *sqlc.Queries, host string) error {
	value, err := json.Marshal(host)
	if err != nil {
		return err
	}
	_, err = q.UpsertSystemSetting(ctx, sqlc.UpsertSystemSettingParams{Key: "site.default_short_link_domain", Value: value})
	return err
}

// Delete removes only non-default domains without any short-link references.
func (s *Service) Delete(ctx context.Context, actor auth.CurrentUser, input ChangeInput) error {
	if err := s.authorizeAdmin(ctx, actor); err != nil {
		return err
	}
	id, expected, err := parseChange(input.ID, input.ExpectedUpdatedAt)
	if err != nil {
		return err
	}
	return appdb.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockDomainWrites(ctx, tx); err != nil {
			return err
		}
		q := s.queries.WithTx(tx)
		current, err := q.GetManagedDomainForUpdate(ctx, pgUUID(id))
		if err != nil {
			return mapNotFound(err)
		}
		if !current.UpdatedAt.Time.Equal(expected) {
			return ErrVersionConflict
		}
		if current.IsDefault {
			return ErrDomainProtected
		}
		referenced, err := q.DomainHasReferences(ctx, current.ID)
		if err != nil {
			return err
		}
		if referenced {
			return ErrDomainReferenced
		}
		count, err := q.DeleteManagedDomain(ctx, sqlc.DeleteManagedDomainParams{ID: current.ID, UpdatedAt: current.UpdatedAt})
		if err != nil {
			return err
		}
		if count != 1 {
			return ErrVersionConflict
		}
		return nil
	})
}

func (s *Service) authorizeAdmin(ctx context.Context, actor auth.CurrentUser) error {
	if s.permissions == nil {
		return ErrPermissionDenied
	}
	snapshot, err := s.permissions.Resolve(ctx, actor.GroupKey)
	if err != nil {
		return err
	}
	if !snapshot.Has(permission.AdminAccess) || !snapshot.Has(permission.DomainManage) {
		return ErrPermissionDenied
	}
	return nil
}

func (s *Service) validateInput(host, displayName string, groupKeys []string) (string, string, []string, error) {
	normalized, err := NormalizeOrigin(host, s.allowLoopbackHTTP)
	if err != nil {
		return "", "", nil, ErrInvalidInput
	}
	displayName, groups, err := validateNameAndGroups(displayName, groupKeys)
	return normalized, displayName, groups, err
}

func validateNameAndGroups(displayName string, groupKeys []string) (string, []string, error) {
	displayName = strings.TrimSpace(displayName)
	if displayName == "" || len([]rune(displayName)) > 80 || groupKeys == nil || len(groupKeys) > 2 {
		return "", nil, ErrInvalidInput
	}
	seen := map[string]bool{}
	for _, key := range groupKeys {
		if (key != permission.GroupUser && key != permission.GroupAdmin) || seen[key] {
			return "", nil, ErrInvalidInput
		}
		seen[key] = true
	}
	return displayName, groupKeys, nil
}

func lockDomainWrites(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock($1)`, domainWriteLockKey)
	return err
}

// LockShortLinkCreation waits for domain writes before reading the current default.
// The shared transaction lock remains held until the short link is committed.
func LockShortLinkCreation(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock_shared($1)`, domainWriteLockKey)
	return err
}

func checkAuthorityConflict(ctx context.Context, queries *sqlc.Queries, host string, currentID uuid.UUID) error {
	wanted, err := Authority(host)
	if err != nil {
		return err
	}
	rows, err := queries.ListDomainHosts(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if uuid.UUID(row.ID.Bytes) == currentID {
			continue
		}
		stored, err := Authority(row.Host)
		if (err == nil && stored == wanted) || row.Host == host {
			return ErrDomainConflict
		}
	}
	return nil
}

func replaceGrants(ctx context.Context, queries *sqlc.Queries, domainID pgtype.UUID, keys []string) error {
	if err := queries.DeleteDomainGrants(ctx, domainID); err != nil {
		return err
	}
	for _, key := range keys {
		count, err := queries.InsertDomainGrant(ctx, sqlc.InsertDomainGrantParams{DomainID: domainID, Key: key})
		if err != nil {
			return err
		}
		if count != 1 {
			return ErrInvalidInput
		}
	}
	return nil
}

func parseChange(id, updatedAt string) (uuid.UUID, time.Time, error) {
	parsedID, err := uuid.Parse(id)
	if err != nil {
		return uuid.Nil, time.Time{}, ErrInvalidInput
	}
	parsedTime, err := time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return uuid.Nil, time.Time{}, ErrInvalidInput
	}
	return parsedID, parsedTime.UTC(), nil
}

func domainFromRow(row sqlc.Domain, groups []string, referenced bool) Domain {
	return Domain{ID: uuid.UUID(row.ID.Bytes).String(), Host: row.Host, DisplayName: row.DisplayName,
		Purpose: row.Purpose, Enabled: row.Enabled, IsDefault: row.IsDefault,
		AllowedGroups: groups, Referenced: referenced, UpdatedAt: formatUpdatedAt(row.UpdatedAt)}
}

func formatUpdatedAt(value pgtype.Timestamptz) string {
	return value.Time.UTC().Format(time.RFC3339Nano)
}

func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

func mapNotFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrDomainNotFound
	}
	return err
}

func mapUniqueConflict(err error) error {
	pgErr := new(pgconn.PgError)
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrDomainConflict
	}
	return err
}
