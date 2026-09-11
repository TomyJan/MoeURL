package oidc

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestProviderServiceCreateValidatesAuthorizationDiscoveryAndSecretStorage verifies the complete provider creation boundary.
func TestProviderServiceCreateValidatesAuthorizationDiscoveryAndSecretStorage(t *testing.T) {
	store := &providerStoreStub{}
	discoverer := &discovererStub{metadata: testDiscoveryMetadata()}
	box := testSecretBox(t)
	service := newProviderService(store, permission.NewService(), discoverer, box, "https://links.example.com", false)

	result, err := service.Create(t.Context(), adminActor(), CreateProviderInput{
		Key:                 " company ",
		DisplayName:         " Company SSO ",
		IssuerURL:           " https://id.example.com ",
		ClientID:            " moeurl ",
		ClientSecret:        "client-secret",
		AllowedEmailDomains: []string{"Example.com"},
		Enabled:             true,
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if discoverer.issuer != "https://id.example.com" {
		t.Fatalf("discovered issuer = %q", discoverer.issuer)
	}
	created := store.created
	if created.Key != "company" || created.DisplayName != "Company SSO" || created.ClientID != "moeurl" || !created.Enabled {
		t.Fatalf("created params = %#v", created)
	}
	if bytes.Equal(created.ClientSecretCiphertext, []byte("client-secret")) || bytes.Contains(created.ClientSecretCiphertext, []byte("client-secret")) {
		t.Fatal("client secret was not encrypted")
	}
	opened, err := box.Open(providerSecretPurpose, uuidString(created.ID), created.ClientSecretCiphertext)
	if err != nil || string(opened) != "client-secret" {
		t.Fatalf("open stored secret: value=%q err=%v", opened, err)
	}
	if string(created.AllowedEmailDomains) != `["example.com"]` {
		t.Fatalf("stored domains = %s", created.AllowedEmailDomains)
	}
	if result.Provider.Key != "company" || !result.Provider.ClientSecretConfigured || result.Provider.CallbackURL != "https://links.example.com/api/v1/auth/oidc/company/callback" {
		t.Fatalf("create result = %#v", result)
	}
}

// TestProviderServiceRequiresAdminAndRuntime verifies authorization precedes persistence and missing deployment secrets fail closed.
func TestProviderServiceRequiresAdminAndRuntime(t *testing.T) {
	input := CreateProviderInput{
		Key: "company", DisplayName: "Company", IssuerURL: "https://id.example.com", ClientID: "moeurl",
		ClientSecret: "secret", AllowedEmailDomains: []string{"example.com"},
	}
	store := &providerStoreStub{}
	service := newProviderService(store, permission.NewService(), &discovererStub{metadata: testDiscoveryMetadata()}, testSecretBox(t), "https://links.example.com", false)
	if _, err := service.Create(t.Context(), auth.CurrentUser{GroupKey: permission.GroupUser}, input); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("user create error = %v", err)
	}
	if store.createCalls != 0 {
		t.Fatalf("store create calls = %d", store.createCalls)
	}

	service = newProviderService(store, permission.NewService(), &discovererStub{metadata: testDiscoveryMetadata()}, nil, "", false)
	if _, err := service.Create(t.Context(), adminActor(), input); !errors.Is(err, ErrRuntimeUnavailable) {
		t.Fatalf("missing runtime create error = %v", err)
	}
}

// TestProviderServiceListAndMethodsExposeOnlyPublicFields verifies management and login projections omit stored secrets.
func TestProviderServiceListAndMethodsExposeOnlyPublicFields(t *testing.T) {
	row := testProviderRow()
	store := &providerStoreStub{
		providers: []sqlc.OidcProvider{row},
		methods:   []sqlc.ListEnabledOIDCProvidersRow{{Key: row.Key, DisplayName: row.DisplayName}},
	}
	service := newProviderService(store, permission.NewService(), &discovererStub{}, testSecretBox(t), "https://links.example.com", false)

	listed, err := service.List(t.Context(), adminActor())
	if err != nil {
		t.Fatalf("list providers: %v", err)
	}
	if len(listed.Providers) != 1 || !listed.Providers[0].ClientSecretConfigured {
		t.Fatalf("listed providers = %#v", listed.Providers)
	}
	methods, err := service.Methods(t.Context())
	if err != nil {
		t.Fatalf("list login methods: %v", err)
	}
	if !methods.Local.Enabled || !reflect.DeepEqual(methods.OIDC, []LoginProvider{{Key: "company", DisplayName: "Company SSO"}}) {
		t.Fatalf("login methods = %#v", methods)
	}
}

// TestProviderServiceRejectsInvalidStoredProviders verifies corrupted provider rows never reach the API.
func TestProviderServiceRejectsInvalidStoredProviders(t *testing.T) {
	for _, row := range []sqlc.OidcProvider{
		{},
		func() sqlc.OidcProvider {
			row := testProviderRow()
			row.AllowedEmailDomains = []byte(`{"unexpected":true}`)
			return row
		}(),
	} {
		store := &providerStoreStub{providers: []sqlc.OidcProvider{row}}
		service := newProviderService(store, permission.NewService(), &discovererStub{}, testSecretBox(t), "https://links.example.com", false)
		if _, err := service.List(t.Context(), adminActor()); err == nil {
			t.Fatalf("invalid row %#v was accepted", row)
		}
	}
}

// TestProviderServiceUpdatePreservesSecretAndClassifiesConflicts verifies optimistic updates retain the current ciphertext.
func TestProviderServiceUpdatePreservesSecretAndClassifiesConflicts(t *testing.T) {
	row := testProviderRow()
	store := &providerStoreStub{provider: row}
	service := newProviderService(store, permission.NewService(), &discovererStub{metadata: testDiscoveryMetadata()}, testSecretBox(t), "https://links.example.com", false)
	input := UpdateProviderInput{
		ID:                  uuidString(row.ID),
		DisplayName:         "Updated SSO",
		IssuerURL:           row.IssuerUrl,
		ClientID:            row.ClientID,
		ClientSecret:        SecretChange{Mode: SecretPreserve},
		AllowedEmailDomains: []string{"example.com"},
		Enabled:             true,
		ExpectedUpdatedAt:   row.UpdatedAt.Time.Format(time.RFC3339Nano),
	}

	result, err := service.Update(t.Context(), adminActor(), input)
	if err != nil {
		t.Fatalf("update provider: %v", err)
	}
	if !bytes.Equal(store.updated.ClientSecretCiphertext, row.ClientSecretCiphertext) {
		t.Fatal("preserve update replaced client secret ciphertext")
	}
	if result.Provider.DisplayName != "Updated SSO" {
		t.Fatalf("updated provider = %#v", result.Provider)
	}

	store.updateErr = pgx.ErrNoRows
	if _, err := service.Update(t.Context(), adminActor(), input); !errors.Is(err, ErrProviderConflict) {
		t.Fatalf("stale update error = %v", err)
	}
	store.providerErr = pgx.ErrNoRows
	if _, err := service.Update(t.Context(), adminActor(), input); !errors.Is(err, ErrProviderNotFound) {
		t.Fatalf("missing update error = %v", err)
	}
}

// TestProviderServiceAllowsDisablingWithoutDiscovery keeps emergency shutdown independent from provider availability.
func TestProviderServiceAllowsDisablingWithoutDiscovery(t *testing.T) {
	row := testProviderRow()
	store := &providerStoreStub{provider: row}
	discoverer := &discovererStub{err: errors.New("provider unavailable")}
	service := newProviderService(store, permission.NewService(), discoverer, testSecretBox(t), "https://links.example.com", false)

	result, err := service.Update(t.Context(), adminActor(), UpdateProviderInput{
		ID:                  uuidString(row.ID),
		DisplayName:         row.DisplayName,
		IssuerURL:           row.IssuerUrl,
		ClientID:            row.ClientID,
		ClientSecret:        SecretChange{Mode: SecretPreserve},
		AllowedEmailDomains: []string{"example.com"},
		Enabled:             false,
		ExpectedUpdatedAt:   row.UpdatedAt.Time.Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatalf("disable provider: %v", err)
	}
	if result.Provider.Enabled || discoverer.issuer != "" {
		t.Fatalf("disabled provider = %#v, discovery issuer = %q", result.Provider, discoverer.issuer)
	}
	if store.updated.AuthorizationEndpoint != row.AuthorizationEndpoint || store.updated.TokenEndpoint != row.TokenEndpoint || store.updated.JwksUri != row.JwksUri {
		t.Fatalf("stored endpoints changed while disabling: %#v", store.updated)
	}
}

// TestProviderServiceRejectsEnablingWithUnavailablePreservedSecret verifies re-enabling cannot publish an unusable provider.
func TestProviderServiceRejectsEnablingWithUnavailablePreservedSecret(t *testing.T) {
	row := testProviderRow()
	row.Enabled = false
	providerID := uuidString(row.ID)
	originalBox := testSecretBox(t)
	ciphertext, err := originalBox.Seal(providerSecretPurpose, providerID, []byte("client-secret"))
	if err != nil {
		t.Fatalf("seal provider secret: %v", err)
	}
	row.ClientSecretCiphertext = ciphertext
	store := &providerStoreStub{provider: row}
	wrongBox, err := NewSecretBox(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{8}, 32)))
	if err != nil {
		t.Fatalf("create wrong secret box: %v", err)
	}
	service := newProviderService(store, permission.NewService(), &discovererStub{metadata: testDiscoveryMetadata()}, wrongBox, "https://links.example.com", false)

	_, err = service.Update(t.Context(), adminActor(), UpdateProviderInput{
		ID: providerID, DisplayName: row.DisplayName, IssuerURL: row.IssuerUrl, ClientID: row.ClientID,
		ClientSecret: SecretChange{Mode: SecretPreserve}, AllowedEmailDomains: []string{"example.com"}, Enabled: true,
		ExpectedUpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339Nano),
	})
	if !errors.Is(err, ErrRuntimeUnavailable) {
		t.Fatalf("enable provider error = %v, want ErrRuntimeUnavailable", err)
	}
	if store.updated.ID.Valid {
		t.Fatalf("unavailable provider reached persistence: %#v", store.updated)
	}
}

// TestProviderServiceFailsClosedForMissingPermissionsAndStoreErrors verifies administrative reads never fall back open.
func TestProviderServiceFailsClosedForMissingPermissionsAndStoreErrors(t *testing.T) {
	store := &providerStoreStub{}
	service := newProviderService(store, nil, &discovererStub{}, testSecretBox(t), "https://links.example.com", false)
	if _, err := service.List(t.Context(), adminActor()); !errors.Is(err, ErrRuntimeUnavailable) {
		t.Fatalf("missing resolver error = %v", err)
	}

	store.listErr = errors.New("database unavailable")
	service = newProviderService(store, permission.NewService(), &discovererStub{}, testSecretBox(t), "https://links.example.com", false)
	if _, err := service.List(t.Context(), adminActor()); !errors.Is(err, store.listErr) {
		t.Fatalf("list error = %v", err)
	}
	store.methodsErr = errors.New("methods unavailable")
	if _, err := service.Methods(t.Context()); !errors.Is(err, store.methodsErr) {
		t.Fatalf("methods error = %v", err)
	}

	permissionErr := errors.New("permission unavailable")
	service = newProviderService(store, permissionResolverStub{err: permissionErr}, nil, nil, "", false)
	if _, err := service.Update(t.Context(), adminActor(), UpdateProviderInput{}); !errors.Is(err, permissionErr) {
		t.Fatalf("update permission error = %v", err)
	}
	if _, err := service.Delete(t.Context(), adminActor(), DeleteProviderInput{}); !errors.Is(err, permissionErr) {
		t.Fatalf("delete permission error = %v", err)
	}
}

// TestProviderServiceCreateClassifiesInputDiscoveryAndPersistenceFailures verifies stable create errors.
func TestProviderServiceCreateClassifiesInputDiscoveryAndPersistenceFailures(t *testing.T) {
	valid := CreateProviderInput{Key: "company", DisplayName: "Company", IssuerURL: "https://id.example.com", ClientID: "client", ClientSecret: "secret", AllowedEmailDomains: []string{"example.com"}, Enabled: true}
	store := &providerStoreStub{}
	discoverer := &discovererStub{metadata: testDiscoveryMetadata()}
	service := newProviderService(store, permission.NewService(), discoverer, testSecretBox(t), "https://links.example.com", false)

	invalid := valid
	invalid.ClientSecret = ""
	if _, err := service.Create(t.Context(), adminActor(), invalid); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid create error = %v", err)
	}
	discoverer.err = errors.New("provider unavailable")
	if _, err := service.Create(t.Context(), adminActor(), valid); !errors.Is(err, ErrDiscoveryUnavailable) {
		t.Fatalf("discovery create error = %v", err)
	}
	discoverer.err = nil
	store.createErr = &pgconn.PgError{Code: "23505"}
	if _, err := service.Create(t.Context(), adminActor(), valid); !errors.Is(err, ErrProviderKeyExists) {
		t.Fatalf("duplicate create error = %v", err)
	}
	store.createErr = errors.New("database unavailable")
	if _, err := service.Create(t.Context(), adminActor(), valid); !errors.Is(err, store.createErr) {
		t.Fatalf("database create error = %v", err)
	}
	store.createErr = nil
	service.secrets = &SecretBox{}
	if _, err := service.Create(t.Context(), adminActor(), valid); !errors.Is(err, ErrSecretUnavailable) {
		t.Fatalf("secret create error = %v", err)
	}
}

// TestProviderServiceUpdateRefreshesDiscoveryForRuntimeChanges verifies security-sensitive changes refresh endpoints.
func TestProviderServiceUpdateRefreshesDiscoveryForRuntimeChanges(t *testing.T) {
	row := testProviderRow()
	store := &providerStoreStub{provider: row}
	discoverer := &discovererStub{metadata: DiscoveryMetadata{
		Issuer: "https://new.example.com", AuthorizationEndpoint: "https://new.example.com/authorize",
		TokenEndpoint: "https://new.example.com/token", JWKSURI: "https://new.example.com/jwks",
	}}
	box := testSecretBox(t)
	service := newProviderService(store, permission.NewService(), discoverer, box, "https://links.example.com", false)
	result, err := service.Update(t.Context(), adminActor(), UpdateProviderInput{
		ID: uuidString(row.ID), DisplayName: row.DisplayName, IssuerURL: "https://new.example.com", ClientID: "new-client",
		ClientSecret: SecretChange{Mode: SecretSet, Value: "new-secret"}, AllowedEmailDomains: []string{"example.com"}, Enabled: true,
		ExpectedUpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatalf("update runtime: %v", err)
	}
	if discoverer.issuer != "https://new.example.com" || result.Provider.IssuerURL != "https://new.example.com" || store.updated.TokenEndpoint != "https://new.example.com/token" {
		t.Fatalf("runtime update = discovery %q result %#v params %#v", discoverer.issuer, result.Provider, store.updated)
	}
	opened, err := box.Open(providerSecretPurpose, uuidString(row.ID), store.updated.ClientSecretCiphertext)
	if err != nil || string(opened) != "new-secret" {
		t.Fatalf("updated secret = %q error %v", opened, err)
	}
}

// TestProviderServiceRejectsInvalidUpdates verifies optimistic identifiers and secret modes fail before persistence.
func TestProviderServiceRejectsInvalidUpdates(t *testing.T) {
	row := testProviderRow()
	base := UpdateProviderInput{
		ID: uuidString(row.ID), DisplayName: row.DisplayName, IssuerURL: row.IssuerUrl, ClientID: row.ClientID,
		ClientSecret: SecretChange{Mode: SecretPreserve}, AllowedEmailDomains: []string{"example.com"}, Enabled: true,
		ExpectedUpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339Nano),
	}
	for _, mutate := range []func(*UpdateProviderInput){
		func(value *UpdateProviderInput) { value.ID = "invalid" },
		func(value *UpdateProviderInput) { value.ExpectedUpdatedAt = "invalid" },
		func(value *UpdateProviderInput) { value.DisplayName = "" },
		func(value *UpdateProviderInput) {
			value.ClientSecret = SecretChange{Mode: SecretPreserve, Value: "unexpected"}
		},
		func(value *UpdateProviderInput) { value.ClientSecret = SecretChange{Mode: SecretSet} },
		func(value *UpdateProviderInput) { value.ClientSecret = SecretChange{Mode: "unknown"} },
	} {
		input := base
		mutate(&input)
		store := &providerStoreStub{provider: row}
		service := newProviderService(store, permission.NewService(), &discovererStub{metadata: testDiscoveryMetadata()}, testSecretBox(t), "https://links.example.com", false)
		if _, err := service.Update(t.Context(), adminActor(), input); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid update %#v error = %v", input, err)
		}
		if store.updated.ID.Valid {
			t.Fatalf("invalid update reached persistence: %#v", store.updated)
		}
	}
}

// TestProviderServiceUpdateClassifiesRuntimeAndPersistenceFailures verifies every external update boundary fails closed.
func TestProviderServiceUpdateClassifiesRuntimeAndPersistenceFailures(t *testing.T) {
	row := testProviderRow()
	input := UpdateProviderInput{
		ID: uuidString(row.ID), DisplayName: row.DisplayName, IssuerURL: row.IssuerUrl, ClientID: row.ClientID,
		ClientSecret: SecretChange{Mode: SecretPreserve}, AllowedEmailDomains: []string{"example.com"}, Enabled: true,
		ExpectedUpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339Nano),
	}
	store := &providerStoreStub{provider: row}
	service := newProviderService(store, permission.NewService(), nil, nil, "", false)
	if _, err := service.Update(t.Context(), adminActor(), input); !errors.Is(err, ErrRuntimeUnavailable) {
		t.Fatalf("missing runtime update error = %v", err)
	}

	service = newProviderService(store, permission.NewService(), &discovererStub{metadata: testDiscoveryMetadata()}, testSecretBox(t), "https://links.example.com", false)
	store.providerErr = errors.New("provider read failed")
	if _, err := service.Update(t.Context(), adminActor(), input); !errors.Is(err, store.providerErr) {
		t.Fatalf("provider read error = %v", err)
	}
	store.providerErr = nil
	input.ClientSecret = SecretChange{Mode: SecretSet, Value: "replacement"}
	service.secrets = &SecretBox{}
	if _, err := service.Update(t.Context(), adminActor(), input); !errors.Is(err, ErrSecretUnavailable) {
		t.Fatalf("secret update error = %v", err)
	}

	service.secrets = testSecretBox(t)
	service.discoverer = &discovererStub{err: errors.New("discovery failed")}
	if _, err := service.Update(t.Context(), adminActor(), input); !errors.Is(err, ErrDiscoveryUnavailable) {
		t.Fatalf("discovery update error = %v", err)
	}

	input.ClientSecret = SecretChange{Mode: SecretPreserve}
	service.discoverer = &discovererStub{metadata: testDiscoveryMetadata()}
	store.updateErr = errors.New("update failed")
	if _, err := service.Update(t.Context(), adminActor(), input); !errors.Is(err, store.updateErr) {
		t.Fatalf("persistence update error = %v", err)
	}
	store.updateErr = pgx.ErrNoRows
	store.providerErr = errors.New("conflict lookup failed")
	if _, err := service.Update(t.Context(), adminActor(), input); !errors.Is(err, store.providerErr) {
		t.Fatalf("conflict lookup error = %v", err)
	}
}

// TestProviderServiceDeleteClassifiesConditionalWrites verifies soft-delete optimistic behavior.
func TestProviderServiceDeleteClassifiesConditionalWrites(t *testing.T) {
	row := testProviderRow()
	input := DeleteProviderInput{ID: uuidString(row.ID), ExpectedUpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339Nano)}
	store := &providerStoreStub{provider: row}
	service := newProviderService(store, permission.NewService(), nil, nil, "", false)
	result, err := service.Delete(t.Context(), adminActor(), input)
	if err != nil || !result.Deleted {
		t.Fatalf("delete result = %#v error %v", result, err)
	}
	store.deleteErr = pgx.ErrNoRows
	if _, err := service.Delete(t.Context(), adminActor(), input); !errors.Is(err, ErrProviderConflict) {
		t.Fatalf("stale delete error = %v", err)
	}
	store.providerErr = pgx.ErrNoRows
	if _, err := service.Delete(t.Context(), adminActor(), input); !errors.Is(err, ErrProviderNotFound) {
		t.Fatalf("missing delete error = %v", err)
	}
	input.ID = "invalid"
	if _, err := service.Delete(t.Context(), adminActor(), input); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid delete error = %v", err)
	}
	input = DeleteProviderInput{ID: uuidString(row.ID), ExpectedUpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339Nano)}
	store.deleteErr = errors.New("delete failed")
	if _, err := service.Delete(t.Context(), adminActor(), input); !errors.Is(err, store.deleteErr) {
		t.Fatalf("database delete error = %v", err)
	}
	store.providerErr = errors.New("conditional lookup failed")
	if err := service.classifyConditionalMiss(t.Context(), uuid.UUID(row.ID.Bytes)); !errors.Is(err, store.providerErr) {
		t.Fatalf("conditional lookup error = %v", err)
	}
}

// TestProviderServiceProductionConstructorWiresDatabaseStore verifies the exported constructor retains production dependencies.
func TestProviderServiceProductionConstructorWiresDatabaseStore(t *testing.T) {
	service := NewProviderService(nil, permission.NewService(), nil, nil, " https://links.example.com/ ", false)
	if service == nil || service.store == nil || service.publicBaseURL != "https://links.example.com" {
		t.Fatalf("production service = %#v", service)
	}
}

// adminActor returns the stable actor used by provider authorization tests.
func adminActor() auth.CurrentUser {
	return auth.CurrentUser{ID: uuid.NewString(), GroupKey: permission.GroupAdmin}
}

// testSecretBox creates an isolated deterministic-length encryption key.
func testSecretBox(t *testing.T) *SecretBox {
	t.Helper()
	box, err := NewSecretBox(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)))
	if err != nil {
		t.Fatalf("create test secret box: %v", err)
	}
	return box
}

// testDiscoveryMetadata returns one internally consistent provider document.
func testDiscoveryMetadata() DiscoveryMetadata {
	return DiscoveryMetadata{
		Issuer:                "https://id.example.com",
		AuthorizationEndpoint: "https://id.example.com/authorize",
		TokenEndpoint:         "https://id.example.com/token",
		JWKSURI:               "https://id.example.com/jwks",
	}
}

// testProviderRow returns one complete persisted provider fixture.
func testProviderRow() sqlc.OidcProvider {
	id := uuid.New()
	now := time.Now().UTC().Truncate(time.Microsecond)
	return sqlc.OidcProvider{
		ID: uuidToPGUUID(id), Key: "company", DisplayName: "Company SSO",
		IssuerUrl: "https://id.example.com", ClientID: "moeurl", ClientSecretCiphertext: []byte{1, 2, 3},
		AuthorizationEndpoint: "https://id.example.com/authorize", TokenEndpoint: "https://id.example.com/token",
		JwksUri: "https://id.example.com/jwks", AllowedEmailDomains: []byte(`["example.com"]`), Enabled: true,
		CreatedAt: pgtype.Timestamptz{Time: now, Valid: true}, UpdatedAt: pgtype.Timestamptz{Time: now, Valid: true},
	}
}

type discovererStub struct {
	metadata DiscoveryMetadata
	err      error
	issuer   string
}

type permissionResolverStub struct {
	err error
}

func (s permissionResolverStub) Resolve(context.Context, string) (permission.Snapshot, error) {
	return permission.Snapshot{}, s.err
}

func (d *discovererStub) Discover(_ context.Context, issuer string) (DiscoveryMetadata, error) {
	d.issuer = issuer
	return d.metadata, d.err
}

type providerStoreStub struct {
	providers   []sqlc.OidcProvider
	methods     []sqlc.ListEnabledOIDCProvidersRow
	listErr     error
	methodsErr  error
	provider    sqlc.OidcProvider
	providerErr error
	created     sqlc.CreateOIDCProviderParams
	updated     sqlc.UpdateOIDCProviderParams
	createErr   error
	updateErr   error
	deleteErr   error
	createCalls int
}

func (s *providerStoreStub) ListOIDCProviders(context.Context) ([]sqlc.OidcProvider, error) {
	return s.providers, s.listErr
}

func (s *providerStoreStub) ListEnabledOIDCProviders(context.Context) ([]sqlc.ListEnabledOIDCProvidersRow, error) {
	return s.methods, s.methodsErr
}

func (s *providerStoreStub) GetOIDCProviderByID(context.Context, pgtype.UUID) (sqlc.OidcProvider, error) {
	return s.provider, s.providerErr
}

func (s *providerStoreStub) CreateOIDCProvider(_ context.Context, input sqlc.CreateOIDCProviderParams) (sqlc.OidcProvider, error) {
	s.createCalls++
	s.created = input
	if s.createErr != nil {
		return sqlc.OidcProvider{}, s.createErr
	}
	row := testProviderRow()
	row.ID = input.ID
	row.Key = input.Key
	row.DisplayName = input.DisplayName
	row.IssuerUrl = input.IssuerUrl
	row.ClientID = input.ClientID
	row.ClientSecretCiphertext = input.ClientSecretCiphertext
	row.AuthorizationEndpoint = input.AuthorizationEndpoint
	row.TokenEndpoint = input.TokenEndpoint
	row.JwksUri = input.JwksUri
	row.AllowedEmailDomains = input.AllowedEmailDomains
	row.Enabled = input.Enabled
	return row, nil
}

func (s *providerStoreStub) UpdateOIDCProvider(_ context.Context, input sqlc.UpdateOIDCProviderParams) (sqlc.OidcProvider, error) {
	s.updated = input
	if s.updateErr != nil {
		return sqlc.OidcProvider{}, s.updateErr
	}
	row := s.provider
	row.DisplayName = input.DisplayName
	row.IssuerUrl = input.IssuerUrl
	row.ClientID = input.ClientID
	row.ClientSecretCiphertext = input.ClientSecretCiphertext
	row.AuthorizationEndpoint = input.AuthorizationEndpoint
	row.TokenEndpoint = input.TokenEndpoint
	row.JwksUri = input.JwksUri
	row.AllowedEmailDomains = input.AllowedEmailDomains
	row.Enabled = input.Enabled
	row.UpdatedAt = pgtype.Timestamptz{Time: row.UpdatedAt.Time.Add(time.Second), Valid: true}
	return row, nil
}

func (s *providerStoreStub) SoftDeleteOIDCProvider(context.Context, sqlc.SoftDeleteOIDCProviderParams) (sqlc.OidcProvider, error) {
	return s.provider, s.deleteErr
}
