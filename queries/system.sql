-- name: GetSystemSetting :one
select key, value, created_at, updated_at
from system_setting
where key = $1;

-- name: ListSystemSettings :many
select key, value, created_at, updated_at
from system_setting
where key = any($1::text[])
order by key;

-- name: GetLoginMethodsSnapshot :one
select
    local_login.value::jsonb as local_login_enabled,
    coalesce(
        (select array_agg(key order by key) from oidc_provider where enabled and deleted_at is null),
        array[]::text[]
    )::text[] as provider_keys,
    coalesce(
        (select array_agg(display_name order by key) from oidc_provider where enabled and deleted_at is null),
        array[]::text[]
    )::text[] as provider_display_names
from system_setting as local_login
where local_login.key = 'auth.local_login_enabled';

-- name: GetSystemSettingForUpdate :one
select key, value, created_at, updated_at
from system_setting
where key = $1
for update;

-- name: UpdateSystemSettingValue :one
update system_setting
set value = $2,
    updated_at = $3
where key = $1
returning key, value, created_at, updated_at;

-- name: UpsertSystemSetting :one
insert into system_setting (key, value, created_at, updated_at)
values ($1, $2, now(), now())
on conflict (key) do update
set value = excluded.value,
    updated_at = now()
returning key, value, created_at, updated_at;
