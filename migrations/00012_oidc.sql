-- +goose Up
-- +goose StatementBegin
create table oidc_provider (
    id uuid primary key,
    key text not null unique,
    display_name text not null,
    issuer_url text not null,
    client_id text not null,
    client_secret_ciphertext bytea not null,
    authorization_endpoint text not null,
    token_endpoint text not null,
    jwks_uri text not null,
    allowed_email_domains jsonb not null,
    enabled boolean not null default false,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    constraint oidc_provider_key_check check (key ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
    constraint oidc_provider_display_name_check check (char_length(display_name) between 1 and 100),
    constraint oidc_provider_issuer_url_check check (char_length(issuer_url) between 1 and 2048),
    constraint oidc_provider_client_id_check check (char_length(client_id) between 1 and 512),
    constraint oidc_provider_client_secret_check check (octet_length(client_secret_ciphertext) > 0),
    constraint oidc_provider_authorization_endpoint_check check (char_length(authorization_endpoint) between 1 and 2048),
    constraint oidc_provider_token_endpoint_check check (char_length(token_endpoint) between 1 and 2048),
    constraint oidc_provider_jwks_uri_check check (char_length(jwks_uri) between 1 and 2048),
    constraint oidc_provider_allowed_email_domains_check check (
        jsonb_typeof(allowed_email_domains) = 'array'
        and jsonb_array_length(allowed_email_domains) > 0
    )
);

create table external_identity (
    provider_id uuid not null references oidc_provider(id) on delete restrict,
    subject text not null,
    user_id uuid not null references app_user(id) on delete cascade,
    created_at timestamptz not null,
    last_login_at timestamptz not null,
    primary key (provider_id, subject),
    unique (provider_id, user_id),
    constraint external_identity_subject_check check (char_length(subject) between 1 and 1024)
);

create table oidc_login_attempt (
    state_hash bytea primary key,
    provider_id uuid not null references oidc_provider(id) on delete cascade,
    nonce_hash bytea not null,
    verifier_ciphertext bytea not null,
    return_path text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null,
    constraint oidc_login_attempt_state_hash_check check (octet_length(state_hash) = 32),
    constraint oidc_login_attempt_nonce_hash_check check (octet_length(nonce_hash) = 32),
    constraint oidc_login_attempt_verifier_check check (octet_length(verifier_ciphertext) > 0),
    constraint oidc_login_attempt_return_path_check check (
        char_length(return_path) between 1 and 2048
        and left(return_path, 1) = '/'
        and left(return_path, 2) <> '//'
    )
);

create index oidc_provider_enabled_idx
    on oidc_provider (key)
    where enabled and deleted_at is null;
create index oidc_login_attempt_expires_at_idx on oidc_login_attempt (expires_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
do $$
begin
    if exists (select 1 from external_identity) then
        raise exception 'cannot rollback OIDC migration while external identity bindings exist';
    end if;
end
$$;

drop table oidc_login_attempt;
drop table external_identity;
drop table oidc_provider;
-- +goose StatementEnd
