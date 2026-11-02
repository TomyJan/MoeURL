-- name: GetUserRedirectPreference :one
select p.redirect_mode, p.updated_at
from app_user u
join user_group g on g.id = u.group_id
left join user_redirect_preference p on p.user_id = u.id
where u.id = $1 and u.status = 'active' and u.deleted_at is null
  and g.builtin and g.key <> 'guest';

-- name: LockRedirectPreferenceUser :one
select id, group_id from app_user
where id = $1 and status = 'active' and deleted_at is null
for share;

-- name: LockRedirectPreferenceGroup :one
select id, permissions from user_group
where id = $1 and builtin and key <> 'guest'
for share;

-- name: SaveUserRedirectPreference :one
insert into user_redirect_preference(user_id, redirect_mode)
select sqlc.arg(user_id)::uuid, sqlc.narg(redirect_mode)::text
where sqlc.narg(expected_updated_at)::timestamptz is null
   or exists(select 1 from user_redirect_preference p where p.user_id = sqlc.arg(user_id))
on conflict(user_id) do update
set redirect_mode = excluded.redirect_mode,
    updated_at = greatest(clock_timestamp(), user_redirect_preference.updated_at + interval '1 microsecond')
where sqlc.narg(expected_updated_at)::timestamptz is not null
  and user_redirect_preference.updated_at = sqlc.narg(expected_updated_at)::timestamptz
returning redirect_mode, updated_at;
