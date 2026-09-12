-- name: ListOIDCProviders :many
select *
from oidc_provider
where deleted_at is null
order by display_name, key;

-- name: ListEnabledOIDCProviders :many
select key, display_name
from oidc_provider
where enabled and deleted_at is null
order by display_name, key;

-- name: ListEnabledOIDCProviderRuntime :many
select *
from oidc_provider
where enabled and deleted_at is null
order by key;

-- name: GetOIDCProviderByID :one
select *
from oidc_provider
where id = $1 and deleted_at is null;

-- name: GetEnabledOIDCProviderByKey :one
select *
from oidc_provider
where key = $1 and enabled and deleted_at is null;

-- name: CreateOIDCProvider :one
insert into oidc_provider (
    id,
    key,
    display_name,
    issuer_url,
    client_id,
    client_secret_ciphertext,
    authorization_endpoint,
    token_endpoint,
    jwks_uri,
    allowed_email_domains,
    enabled,
    created_at,
    updated_at
) values (
    sqlc.arg(id),
    sqlc.arg(key),
    sqlc.arg(display_name),
    sqlc.arg(issuer_url),
    sqlc.arg(client_id),
    sqlc.arg(client_secret_ciphertext),
    sqlc.arg(authorization_endpoint),
    sqlc.arg(token_endpoint),
    sqlc.arg(jwks_uri),
    sqlc.arg(allowed_email_domains),
    sqlc.arg(enabled),
    clock_timestamp(),
    clock_timestamp()
)
returning *;

-- name: UpdateOIDCProvider :one
update oidc_provider
set display_name = sqlc.arg(display_name),
    issuer_url = sqlc.arg(issuer_url),
    client_id = sqlc.arg(client_id),
    client_secret_ciphertext = sqlc.arg(client_secret_ciphertext),
    authorization_endpoint = sqlc.arg(authorization_endpoint),
    token_endpoint = sqlc.arg(token_endpoint),
    jwks_uri = sqlc.arg(jwks_uri),
    allowed_email_domains = sqlc.arg(allowed_email_domains),
    enabled = sqlc.arg(enabled),
    updated_at = clock_timestamp()
where id = sqlc.arg(id)
  and updated_at = sqlc.arg(expected_updated_at)
  and deleted_at is null
returning *;

-- name: SoftDeleteOIDCProvider :one
update oidc_provider
set enabled = false,
    deleted_at = clock_timestamp(),
    updated_at = clock_timestamp()
where id = sqlc.arg(id)
  and updated_at = sqlc.arg(expected_updated_at)
  and deleted_at is null
returning *;

-- name: CreateOIDCLoginAttempt :exec
insert into oidc_login_attempt (
    state_hash,
    provider_id,
    nonce_hash,
    browser_binding_hash,
    verifier_ciphertext,
    return_path,
    expires_at,
    created_at
) values (
    sqlc.arg(state_hash),
    sqlc.arg(provider_id),
    sqlc.arg(nonce_hash),
    sqlc.arg(browser_binding_hash),
    sqlc.arg(verifier_ciphertext),
    sqlc.arg(return_path),
    sqlc.arg(expires_at),
    clock_timestamp()
);

-- name: ConsumeOIDCLoginAttempt :one
delete from oidc_login_attempt
where state_hash = $1
returning *;

-- name: DeleteExpiredOIDCLoginAttempts :execrows
with expired as (
    select state_hash
    from oidc_login_attempt
    where expires_at <= clock_timestamp()
    order by expires_at, state_hash
    limit sqlc.arg(batch_size)
    for update skip locked
)
delete from oidc_login_attempt
using expired
where oidc_login_attempt.state_hash = expired.state_hash;

-- name: LockExternalIdentityKey :exec
select pg_advisory_xact_lock(hashtextextended($1, 0));

-- name: GetExternalIdentityUser :one
select app_user.id::text as user_id,
    app_user.username,
    app_user.nickname,
    app_user.status,
    user_group.key as group_key,
    user_group.permissions
from external_identity
join app_user on app_user.id = external_identity.user_id
join user_group on user_group.id = app_user.group_id
where external_identity.provider_id = sqlc.arg(provider_id)
  and external_identity.subject = sqlc.arg(subject)
  and app_user.deleted_at is null;

-- name: CreateOIDCUser :one
insert into app_user (
    id,
    username,
    password_hash,
    nickname,
    group_id,
    status,
    builtin,
    created_at,
    updated_at
)
select sqlc.arg(id),
    sqlc.arg(username),
    null,
    sqlc.arg(nickname),
    user_group.id,
    'active',
    false,
    clock_timestamp(),
    clock_timestamp()
from user_group
where user_group.key = 'user' and user_group.builtin
returning id;

-- name: CreateExternalIdentity :exec
insert into external_identity (provider_id, subject, user_id, created_at, last_login_at)
values (sqlc.arg(provider_id), sqlc.arg(subject), sqlc.arg(user_id), clock_timestamp(), clock_timestamp());

-- name: TouchExternalIdentity :exec
update external_identity
set last_login_at = clock_timestamp()
where provider_id = sqlc.arg(provider_id) and subject = sqlc.arg(subject);
