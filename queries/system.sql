-- name: GetSystemSetting :one
select key, value, created_at, updated_at
from system_setting
where key = $1;

-- name: ListSystemSettings :many
select key, value, created_at, updated_at
from system_setting
where key = any($1::text[])
order by key;

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
