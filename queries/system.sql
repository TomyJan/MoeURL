-- name: GetSystemSetting :one
select key, value, created_at, updated_at
from system_setting
where key = $1;

-- name: UpsertSystemSetting :one
insert into system_setting (key, value, created_at, updated_at)
values ($1, $2, now(), now())
on conflict (key) do update
set value = excluded.value,
    updated_at = now()
returning key, value, created_at, updated_at;
