// Package loginpolicy coordinates the process-wide invariant that at least one login method remains usable.
package loginpolicy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const localLoginSettingKey = "auth.local_login_enabled"

var (
	// ErrInvalidPolicy indicates that the persisted local-login setting cannot be trusted.
	ErrInvalidPolicy = errors.New("invalid local login policy")
	// ErrNoAvailableProvider indicates that disabling local login would leave no usable entry point.
	ErrNoAvailableProvider = errors.New("no available OIDC provider")
)

// RuntimeValidator verifies the persisted runtime fields and encrypted secrets for enabled providers.
type RuntimeValidator func([]sqlc.OidcProvider) error

// Reader exposes the local-login admission decision to authentication services.
type Reader interface {
	LocalLoginEnabled(context.Context) (bool, error)
}

// Service reads and locks the shared login-entry policy.
type Service struct {
	queries   *sqlc.Queries
	validator RuntimeValidator
}

// NewService creates a policy service backed by the application database.
func NewService(pool *pgxpool.Pool, validator RuntimeValidator) *Service {
	return &Service{queries: sqlc.New(pool), validator: validator}
}

// LocalLoginEnabled reports whether new password-login attempts are admitted.
func (s *Service) LocalLoginEnabled(ctx context.Context) (bool, error) {
	setting, err := s.queries.GetSystemSetting(ctx, localLoginSettingKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return parseEnabled(setting.Value)
}

// LoginMethodsSnapshot reads the local policy and enabled providers from one database statement snapshot.
func (s *Service) LoginMethodsSnapshot(ctx context.Context) (bool, []sqlc.ListEnabledOIDCProvidersRow, error) {
	row, err := s.queries.GetLoginMethodsSnapshot(ctx)
	if err != nil {
		return false, nil, err
	}
	enabled, err := parseEnabled(row.LocalLoginEnabled)
	if err != nil {
		return false, nil, err
	}
	providers := make([]sqlc.ListEnabledOIDCProvidersRow, len(row.ProviderKeys))
	for index := range row.ProviderKeys {
		providers[index] = sqlc.ListEnabledOIDCProvidersRow{
			Key:         row.ProviderKeys[index],
			DisplayName: row.ProviderDisplayNames[index],
		}
	}
	return enabled, providers, nil
}

// LockLocalLogin locks and returns the local-login policy inside an existing transaction.
func (s *Service) LockLocalLogin(ctx context.Context, tx pgx.Tx) (bool, error) {
	setting, err := s.queries.WithTx(tx).GetSystemSettingForUpdate(ctx, localLoginSettingKey)
	if err != nil {
		return false, err
	}
	return parseEnabled(setting.Value)
}

// RequireAvailableProvider verifies the transaction's final enabled-provider set.
func (s *Service) RequireAvailableProvider(ctx context.Context, tx pgx.Tx) error {
	rows, err := s.queries.WithTx(tx).ListEnabledOIDCProviderRuntime(ctx)
	if err != nil {
		return err
	}
	return s.validateProviders(rows)
}

// ValidateStartup rejects an application state with no usable login entry point.
func (s *Service) ValidateStartup(ctx context.Context) error {
	enabled, err := s.LocalLoginEnabled(ctx)
	if err != nil || enabled {
		return err
	}
	rows, err := s.queries.ListEnabledOIDCProviderRuntime(ctx)
	if err != nil {
		return err
	}
	return s.validateProviders(rows)
}

func (s *Service) validateProviders(rows []sqlc.OidcProvider) error {
	if len(rows) == 0 || s.validator == nil {
		return ErrNoAvailableProvider
	}
	if err := s.validator(rows); err != nil {
		return fmt.Errorf("%w: %w", ErrNoAvailableProvider, err)
	}
	return nil
}

func parseEnabled(value []byte) (bool, error) {
	var enabled *bool
	if err := json.Unmarshal(value, &enabled); err != nil || enabled == nil {
		return false, ErrInvalidPolicy
	}
	return *enabled, nil
}
