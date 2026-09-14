package oidc

// DiscoveryMetadata contains the trusted endpoints persisted from standard OIDC discovery.
type DiscoveryMetadata struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	JWKSURI               string `json:"jwks_uri"`
}

// providerInput is the normalized common input for provider creation and updates.
type providerInput struct {
	Key                 string
	DisplayName         string
	IssuerURL           string
	ClientID            string
	AllowedEmailDomains []string
}

const (
	SecretPreserve = "preserve"
	SecretSet      = "set"
)

// Provider is the secret-free administrative representation of one OIDC provider.
type Provider struct {
	ID                     string   `json:"id"`
	Key                    string   `json:"key"`
	DisplayName            string   `json:"displayName"`
	IssuerURL              string   `json:"issuerUrl"`
	ClientID               string   `json:"clientId"`
	ClientSecretConfigured bool     `json:"clientSecretConfigured"`
	AllowedEmailDomains    []string `json:"allowedEmailDomains"`
	Enabled                bool     `json:"enabled"`
	CallbackURL            string   `json:"callbackUrl"`
	UpdatedAt              string   `json:"updatedAt"`
}

// LoginProvider identifies one enabled provider on the public login page.
type LoginProvider struct {
	Key         string `json:"key"`
	DisplayName string `json:"displayName"`
}

// LoginMethods describes currently available local and external authentication methods.
type LoginMethods struct {
	Local struct {
		Enabled bool `json:"enabled"`
	} `json:"local"`
	OIDC []LoginProvider `json:"oidc"`
}

// ProviderList contains every active administrative provider configuration.
type ProviderList struct {
	Providers []Provider `json:"providers"`
}

// CreateProviderInput contains a new provider and its initial secret.
type CreateProviderInput struct {
	Key                 string   `json:"key"`
	DisplayName         string   `json:"displayName"`
	IssuerURL           string   `json:"issuerUrl"`
	ClientID            string   `json:"clientId"`
	ClientSecret        string   `json:"clientSecret"`
	AllowedEmailDomains []string `json:"allowedEmailDomains"`
	Enabled             bool     `json:"enabled"`
}

// SecretChange describes whether an update preserves or replaces the configured secret.
type SecretChange struct {
	Mode  string `json:"mode"`
	Value string `json:"value,omitempty"`
}

// UpdateProviderInput contains one complete optimistic provider update.
type UpdateProviderInput struct {
	ID                  string       `json:"id"`
	DisplayName         string       `json:"displayName"`
	IssuerURL           string       `json:"issuerUrl"`
	ClientID            string       `json:"clientId"`
	ClientSecret        SecretChange `json:"clientSecret"`
	AllowedEmailDomains []string     `json:"allowedEmailDomains"`
	Enabled             bool         `json:"enabled"`
	ExpectedUpdatedAt   string       `json:"expectedUpdatedAt"`
}

// DeleteProviderInput identifies a provider through its optimistic concurrency value.
type DeleteProviderInput struct {
	ID                string `json:"id"`
	ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
}

// ProviderResult contains one created or updated provider.
type ProviderResult struct {
	Provider Provider `json:"provider"`
}

// DeleteProviderResult confirms one provider was soft deleted.
type DeleteProviderResult struct {
	Deleted bool `json:"deleted"`
}
