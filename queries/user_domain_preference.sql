-- name: GetUserDomainPreference :one
select p.domain_id, p.updated_at
from app_user u
join user_group g on g.id = u.group_id
left join user_domain_preference p on p.user_id = u.id
where u.id = sqlc.arg(user_id) and u.status = 'active'
  and u.deleted_at is null and g.key <> 'guest';

-- name: LockDomainPreferenceUser :one
select id, group_id from app_user
where id = sqlc.arg(user_id) and status = 'active' and deleted_at is null
for share;

-- name: LockDomainPreferenceGroup :one
select id, key, permissions from user_group
where id = sqlc.arg(group_id) and builtin and key <> 'guest'
for share;

-- name: GetGrantedDomainPreference :one
select d.id from domain d
join domain_user_group dg on dg.domain_id = d.id
where d.id = sqlc.arg(domain_id) and dg.user_group_id = sqlc.arg(group_id)
  and d.enabled and d.purpose = 'short_link'
  and ((d.is_default and sqlc.arg(can_default)::boolean)
       or (not d.is_default and sqlc.arg(can_assigned)::boolean))
for share of d, dg;

-- name: SaveUserDomainPreference :one
insert into user_domain_preference(user_id, domain_id)
select sqlc.arg(user_id)::uuid, sqlc.narg(domain_id)::uuid
where sqlc.narg(expected_updated_at)::timestamptz is null
   or exists(select 1 from user_domain_preference p where p.user_id = sqlc.arg(user_id))
on conflict(user_id) do update
set domain_id = excluded.domain_id,
    updated_at = greatest(clock_timestamp(), user_domain_preference.updated_at + interval '1 microsecond')
where sqlc.narg(expected_updated_at)::timestamptz is not null
  and user_domain_preference.updated_at = sqlc.narg(expected_updated_at)::timestamptz
returning domain_id, updated_at;

-- name: ClearDeletedDomainPreferences :exec
update user_domain_preference
set domain_id = null,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where domain_id = sqlc.arg(domain_id);
