-- name: GetUserTimeZonePreference :one
select p.time_zone, p.updated_at
from app_user u
join user_group g on g.id = u.group_id
left join user_time_zone_preference p on p.user_id = u.id
where u.id = $1 and u.status = 'active' and u.deleted_at is null
  and g.builtin and g.key <> 'guest';

-- name: LockTimeZonePreferenceUser :one
select id, group_id from app_user
where id = $1 and status = 'active' and deleted_at is null
for share;

-- name: LockTimeZonePreferenceGroup :one
select id from user_group
where id = $1 and builtin and key <> 'guest'
for share;

-- name: SaveUserTimeZonePreference :one
insert into user_time_zone_preference(user_id, time_zone)
select sqlc.arg(user_id)::uuid, sqlc.narg(time_zone)::text
where sqlc.narg(expected_updated_at)::timestamptz is null
   or exists(select 1 from user_time_zone_preference p where p.user_id = sqlc.arg(user_id))
on conflict(user_id) do update
set time_zone = excluded.time_zone,
    updated_at = greatest(clock_timestamp(), user_time_zone_preference.updated_at + interval '1 microsecond')
where sqlc.narg(expected_updated_at)::timestamptz is not null
  and user_time_zone_preference.updated_at = sqlc.narg(expected_updated_at)::timestamptz
returning time_zone, updated_at;
