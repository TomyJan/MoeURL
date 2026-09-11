package oidc

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	providerSecretPurpose    = "provider-secret"
	providerOperationTimeout = 8 * time.Second
	maxClientSecretBytes     = 4096
)

// ProviderPort exposes public login methods and administrative provider management.
type ProviderPort interface {
	Methods(context.Context) (LoginMethods, error)
	List(context.Context, auth.CurrentUser) (ProviderList, error)
	Create(context.Context, auth.CurrentUser, CreateProviderInput) (ProviderResult, error)
	Update(context.Context, auth.CurrentUser, UpdateProviderInput) (ProviderResult, error)
	Delete(context.Context, auth.CurrentUser, DeleteProviderInput) (DeleteProviderResult, error)
}

// ProviderService manages OIDC provider configuration without exposing encrypted fields.
type ProviderService struct {
	store                 providerStore
	permissions           permission.Resolver
	discoverer            Discoverer
	secrets               *SecretBox
	publicBaseURL         string
	allowInsecureLoopback bool
}

type providerStore interface {
	ListOIDCProviders(context.Context) ([]sqlc.OidcProvider, error)
	ListEnabledOIDCProviders(context.Context) ([]sqlc.ListEnabledOIDCProvidersRow, error)
	GetOIDCProviderByID(context.Context, pgtype.UUID) (sqlc.OidcProvider, error)
	CreateOIDCProvider(context.Context, sqlc.CreateOIDCProviderParams) (sqlc.OidcProvider, error)
	UpdateOIDCProvider(context.Context, sqlc.UpdateOIDCProviderParams) (sqlc.OidcProvider, error)
	SoftDeleteOIDCProvider(context.Context, sqlc.SoftDeleteOIDCProviderParams) (sqlc.OidcProvider, error)
}

type missingPermissionResolver struct{}

// Resolve fails closed when provider management lacks a permission resolver.
func (missingPermissionResolver) Resolve(context.Context, string) (permission.Snapshot, error) {
	return permission.Snapshot{}, ErrRuntimeUnavailable
}

// NewProviderService creates the production provider service from database-backed dependencies.
func NewProviderService(pool *pgxpool.Pool, permissions permission.Resolver, discoverer Discoverer, secrets *SecretBox, publicBaseURL string, allowInsecureLoopback bool) *ProviderService {
	return newProviderService(sqlc.New(pool), permissions, discoverer, secrets, publicBaseURL, allowInsecureLoopback)
}

// newProviderService creates a provider service with an injected store for deterministic tests.
func newProviderService(store providerStore, permissions permission.Resolver, discoverer Discoverer, secrets *SecretBox, publicBaseURL string, allowInsecureLoopback bool) *ProviderService {
	if permissions == nil {
		permissions = missingPermissionResolver{}
	}
	return &ProviderService{
		store: store, permissions: permissions, discoverer: discoverer, secrets: secrets,
		publicBaseURL:         strings.TrimSuffix(strings.TrimSpace(publicBaseURL), "/"),
		allowInsecureLoopback: allowInsecureLoopback,
	}
}

// Methods returns the enabled login providers without administrative configuration.
func (s *ProviderService) Methods(ctx context.Context) (LoginMethods, error) {
	rows, err := s.store.ListEnabledOIDCProviders(ctx)
	if err != nil {
		return LoginMethods{}, err
	}
	result := LoginMethods{OIDC: make([]LoginProvider, 0, len(rows))}
	result.Local.Enabled = true
	for _, row := range rows {
		result.OIDC = append(result.OIDC, LoginProvider{Key: row.Key, DisplayName: row.DisplayName})
	}
	return result, nil
}

// List returns all non-deleted provider configurations after administrative authorization.
func (s *ProviderService) List(ctx context.Context, actor auth.CurrentUser) (ProviderList, error) {
	if err := s.authorize(ctx, actor); err != nil {
		return ProviderList{}, err
	}
	rows, err := s.store.ListOIDCProviders(ctx)
	if err != nil {
		return ProviderList{}, err
	}
	providers := make([]Provider, 0, len(rows))
	for _, row := range rows {
		provider, err := s.providerFromRow(row)
		if err != nil {
			return ProviderList{}, err
		}
		providers = append(providers, provider)
	}
	return ProviderList{Providers: providers}, nil
}

// Create validates discovery metadata and persists one provider with an encrypted secret.
func (s *ProviderService) Create(ctx context.Context, actor auth.CurrentUser, input CreateProviderInput) (ProviderResult, error) {
	if err := s.authorize(ctx, actor); err != nil {
		return ProviderResult{}, err
	}
	if !s.runtimeAvailable() {
		return ProviderResult{}, ErrRuntimeUnavailable
	}
	normalized, err := normalizeProviderInput(providerInput{
		Key: input.Key, DisplayName: input.DisplayName, IssuerURL: input.IssuerURL,
		ClientID: input.ClientID, AllowedEmailDomains: input.AllowedEmailDomains,
	}, s.allowInsecureLoopback)
	if err != nil || len(input.ClientSecret) == 0 || len(input.ClientSecret) > maxClientSecretBytes {
		return ProviderResult{}, ErrInvalidInput
	}
	providerID := uuid.New()
	metadata, err := s.discover(ctx, normalized.IssuerURL)
	if err != nil {
		return ProviderResult{}, err
	}
	ciphertext, err := s.secrets.Seal(providerSecretPurpose, providerID.String(), []byte(input.ClientSecret))
	if err != nil {
		return ProviderResult{}, err
	}
	domains, err := json.Marshal(normalized.AllowedEmailDomains)
	if err != nil {
		return ProviderResult{}, err
	}
	row, err := s.store.CreateOIDCProvider(ctx, sqlc.CreateOIDCProviderParams{
		ID: uuidToPGUUID(providerID), Key: normalized.Key, DisplayName: normalized.DisplayName,
		IssuerUrl: normalized.IssuerURL, ClientID: normalized.ClientID, ClientSecretCiphertext: ciphertext,
		AuthorizationEndpoint: metadata.AuthorizationEndpoint, TokenEndpoint: metadata.TokenEndpoint,
		JwksUri: metadata.JWKSURI, AllowedEmailDomains: domains, Enabled: input.Enabled,
	})
	if isUniqueViolation(err) {
		return ProviderResult{}, ErrProviderKeyExists
	}
	if err != nil {
		return ProviderResult{}, err
	}
	provider, err := s.providerFromRow(row)
	return ProviderResult{Provider: provider}, err
}

// Update replaces one provider when its optimistic concurrency value remains current.
func (s *ProviderService) Update(ctx context.Context, actor auth.CurrentUser, input UpdateProviderInput) (ProviderResult, error) {
	if err := s.authorize(ctx, actor); err != nil {
		return ProviderResult{}, err
	}
	if !s.runtimeAvailable() {
		return ProviderResult{}, ErrRuntimeUnavailable
	}
	id, expectedUpdatedAt, err := parseIdentityAndTimestamp(input.ID, input.ExpectedUpdatedAt)
	if err != nil {
		return ProviderResult{}, ErrInvalidInput
	}
	current, err := s.store.GetOIDCProviderByID(ctx, uuidToPGUUID(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return ProviderResult{}, ErrProviderNotFound
	}
	if err != nil {
		return ProviderResult{}, err
	}
	normalized, err := normalizeProviderInput(providerInput{
		Key: current.Key, DisplayName: input.DisplayName, IssuerURL: input.IssuerURL,
		ClientID: input.ClientID, AllowedEmailDomains: input.AllowedEmailDomains,
	}, s.allowInsecureLoopback)
	if err != nil {
		return ProviderResult{}, err
	}
	ciphertext := current.ClientSecretCiphertext
	switch input.ClientSecret.Mode {
	case SecretPreserve:
		if input.ClientSecret.Value != "" {
			return ProviderResult{}, ErrInvalidInput
		}
	case SecretSet:
		if len(input.ClientSecret.Value) == 0 || len(input.ClientSecret.Value) > maxClientSecretBytes {
			return ProviderResult{}, ErrInvalidInput
		}
		ciphertext, err = s.secrets.Seal(providerSecretPurpose, id.String(), []byte(input.ClientSecret.Value))
		if err != nil {
			return ProviderResult{}, err
		}
	default:
		return ProviderResult{}, ErrInvalidInput
	}
	metadata := DiscoveryMetadata{
		Issuer: current.IssuerUrl, AuthorizationEndpoint: current.AuthorizationEndpoint,
		TokenEndpoint: current.TokenEndpoint, JWKSURI: current.JwksUri,
	}
	if normalized.IssuerURL != current.IssuerUrl || normalized.ClientID != current.ClientID || input.ClientSecret.Mode == SecretSet || (!current.Enabled && input.Enabled) {
		metadata, err = s.discover(ctx, normalized.IssuerURL)
		if err != nil {
			return ProviderResult{}, err
		}
	}
	domains, err := json.Marshal(normalized.AllowedEmailDomains)
	if err != nil {
		return ProviderResult{}, err
	}
	row, err := s.store.UpdateOIDCProvider(ctx, sqlc.UpdateOIDCProviderParams{
		DisplayName: normalized.DisplayName, IssuerUrl: normalized.IssuerURL, ClientID: normalized.ClientID,
		ClientSecretCiphertext: ciphertext, AuthorizationEndpoint: metadata.AuthorizationEndpoint,
		TokenEndpoint: metadata.TokenEndpoint, JwksUri: metadata.JWKSURI,
		AllowedEmailDomains: domains, Enabled: input.Enabled, ID: uuidToPGUUID(id),
		ExpectedUpdatedAt: pgtype.Timestamptz{Time: expectedUpdatedAt, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ProviderResult{}, s.classifyConditionalMiss(ctx, id)
	}
	if err != nil {
		return ProviderResult{}, err
	}
	provider, err := s.providerFromRow(row)
	return ProviderResult{Provider: provider}, err
}

// Delete soft deletes one provider while preserving external identity ownership.
func (s *ProviderService) Delete(ctx context.Context, actor auth.CurrentUser, input DeleteProviderInput) (DeleteProviderResult, error) {
	if err := s.authorize(ctx, actor); err != nil {
		return DeleteProviderResult{}, err
	}
	id, expectedUpdatedAt, err := parseIdentityAndTimestamp(input.ID, input.ExpectedUpdatedAt)
	if err != nil {
		return DeleteProviderResult{}, ErrInvalidInput
	}
	_, err = s.store.SoftDeleteOIDCProvider(ctx, sqlc.SoftDeleteOIDCProviderParams{
		ID: uuidToPGUUID(id), ExpectedUpdatedAt: pgtype.Timestamptz{Time: expectedUpdatedAt, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DeleteProviderResult{}, s.classifyConditionalMiss(ctx, id)
	}
	if err != nil {
		return DeleteProviderResult{}, err
	}
	return DeleteProviderResult{Deleted: true}, nil
}

// authorize resolves the actor's current group snapshot before every administrative operation.
func (s *ProviderService) authorize(ctx context.Context, actor auth.CurrentUser) error {
	snapshot, err := s.permissions.Resolve(ctx, actor.GroupKey)
	if err != nil {
		return err
	}
	if !snapshot.Has(permission.AdminAccess) {
		return ErrPermissionDenied
	}
	return nil
}

// discover bounds provider metadata IO independently from the request lifetime.
func (s *ProviderService) discover(ctx context.Context, issuer string) (DiscoveryMetadata, error) {
	discoveryContext, cancel := context.WithTimeout(ctx, providerOperationTimeout)
	defer cancel()
	metadata, err := s.discoverer.Discover(discoveryContext, issuer)
	if err != nil {
		return DiscoveryMetadata{}, ErrDiscoveryUnavailable
	}
	return metadata, nil
}

// providerFromRow converts a database row into the secret-free API representation.
func (s *ProviderService) providerFromRow(row sqlc.OidcProvider) (Provider, error) {
	if !row.ID.Valid || !row.UpdatedAt.Valid {
		return Provider{}, ErrRuntimeUnavailable
	}
	var domains []string
	if err := json.Unmarshal(row.AllowedEmailDomains, &domains); err != nil {
		return Provider{}, err
	}
	id := uuid.UUID(row.ID.Bytes)
	return Provider{
		ID: id.String(), Key: row.Key, DisplayName: row.DisplayName, IssuerURL: row.IssuerUrl,
		ClientID: row.ClientID, ClientSecretConfigured: len(row.ClientSecretCiphertext) > 0,
		AllowedEmailDomains: domains, Enabled: row.Enabled,
		CallbackURL: s.publicBaseURL + "/api/v1/auth/oidc/" + row.Key + "/callback",
		UpdatedAt:   row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano),
	}, nil
}

// classifyConditionalMiss distinguishes deletion from a stale optimistic value.
func (s *ProviderService) classifyConditionalMiss(ctx context.Context, id uuid.UUID) error {
	_, err := s.store.GetOIDCProviderByID(ctx, uuidToPGUUID(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrProviderNotFound
	}
	if err != nil {
		return err
	}
	return ErrProviderConflict
}

// runtimeAvailable reports whether provider secrets and callback URLs can be used safely.
func (s *ProviderService) runtimeAvailable() bool {
	return s.discoverer != nil && s.secrets != nil && s.publicBaseURL != ""
}

// parseIdentityAndTimestamp validates public optimistic identifiers.
func parseIdentityAndTimestamp(idValue string, timestampValue string) (uuid.UUID, time.Time, error) {
	id, err := uuid.Parse(idValue)
	if err != nil {
		return uuid.Nil, time.Time{}, ErrInvalidInput
	}
	timestamp, err := time.Parse(time.RFC3339Nano, timestampValue)
	if err != nil {
		return uuid.Nil, time.Time{}, ErrInvalidInput
	}
	return id, timestamp.UTC(), nil
}

// isUniqueViolation identifies database uniqueness without exposing constraint diagnostics.
func isUniqueViolation(err error) bool {
	var pgError *pgconn.PgError
	return errors.As(err, &pgError) && pgError.Code == "23505"
}

// uuidToPGUUID converts a UUID to the pgx generated-query representation.
func uuidToPGUUID(value uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: value, Valid: true}
}

// uuidString converts a valid pgx UUID to its canonical string representation.
func uuidString(value pgtype.UUID) string {
	return uuid.UUID(value.Bytes).String()
}
