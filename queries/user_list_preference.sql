-- name: GetUserListPreference :one
select p.page_size, p.updated_at
from app_user u
join user_group g on g.id = u.group_id
left join user_list_preference p on p.user_id = u.id
where u.id = $1 and u.status = 'active' and u.deleted_at is null
  and g.builtin and g.key <> 'guest';

-- name: LockListPreferenceUser :one
select id, group_id from app_user
where id = $1 and status = 'active' and deleted_at is null
for share;

-- name: LockListPreferenceGroup :one
select id from user_group
where id = $1 and builtin and key <> 'guest'
for share;

-- name: SaveUserListPreference :one
insert into user_list_preference(user_id, page_size)
select sqlc.arg(user_id)::uuid, sqlc.narg(page_size)::smallint
where sqlc.narg(expected_updated_at)::timestamptz is null
   or exists(select 1 from user_list_preference p where p.user_id = sqlc.arg(user_id))
on conflict(user_id) do update
set page_size = excluded.page_size,
    updated_at = greatest(clock_timestamp(), user_list_preference.updated_at + interval '1 microsecond')
where sqlc.narg(expected_updated_at)::timestamptz is not null
  and user_list_preference.updated_at = sqlc.narg(expected_updated_at)::timestamptz
returning page_size, updated_at;
