package auth

import (
	"context"
	"errors"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5"
)

// ReadCurrentUserIn projects a validated identity. The caller must hold the account row lock or use a repeatable-read snapshot.
func ReadCurrentUserIn(ctx context.Context, database sqlc.DBTX, userID string) (CurrentUser, error) {
	snapshot, err := (&permission.DatabaseService{}).ResolveAccountIn(ctx, database, userID)
	if err != nil {
		return CurrentUser{}, err
	}
	var current CurrentUser
	var status string
	err = database.QueryRow(ctx, `
		select app_user.id::text, app_user.username, app_user.nickname, user_group.key, app_user.status
		from app_user
		join user_group on user_group.id = app_user.group_id
		where app_user.id = $1 and app_user.deleted_at is null
	`, userID).Scan(&current.ID, &current.Username, &current.Nickname, &current.GroupKey, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return CurrentUser{}, ErrInvalidCredentials
	}
	if err != nil {
		return CurrentUser{}, err
	}
	if status != "active" {
		return CurrentUser{}, ErrUserDisabled
	}
	current.Permissions = make([]string, 0)
	current.SupplementalGroups = make([]string, 0)
	for _, key := range snapshot.GroupKeys() {
		if key != current.GroupKey {
			current.SupplementalGroups = append(current.SupplementalGroups, key)
		}
	}
	for _, definition := range permission.Definitions() {
		if snapshot.Has(definition.Key) {
			current.Permissions = append(current.Permissions, definition.Key)
		}
	}
	return current, nil
}
