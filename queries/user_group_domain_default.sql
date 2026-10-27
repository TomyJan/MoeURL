-- name: LockGroupDefaultAdmin :one
select id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id
from user_group
where id = $1 and builtin and key = 'admin'
for update;

-- name: LockGroupDefaultTarget :one
select id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id
from user_group
where key = $1 and builtin and key in ('user', 'admin')
for update;

-- name: GetGroupDefaultReadActor :one
select g.permissions
from app_user u join user_group g on g.id = u.group_id
where u.id = $1 and u.status = 'active' and u.deleted_at is null
  and g.builtin and g.key = 'admin';

-- name: ListGroupDefaultCandidates :many
select d.id, d.host, d.display_name, d.is_default
from domain d join domain_user_group dg on dg.domain_id = d.id
where dg.user_group_id = sqlc.arg(group_id)
  and d.enabled and d.purpose = 'short_link' and sqlc.arg(can_create)::boolean
  and ((d.is_default and sqlc.arg(can_default)::boolean)
       or (not d.is_default and sqlc.arg(can_assigned)::boolean))
order by d.is_default desc, d.sort_order, d.created_at, d.id;

-- name: SetUserGroupDefaultDomain :one
update user_group
set default_domain_id = sqlc.narg(domain_id)::uuid,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where key = sqlc.arg(group_key) and builtin and key in ('user', 'admin')
  and updated_at = sqlc.arg(expected_updated_at)
returning id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id;

-- name: GetCurrentGroupDefaultDomain :one
select g.permissions, g.default_domain_id, d.id as available_domain_id, d.is_default
from app_user u join user_group g on g.id = u.group_id
left join domain d on d.id = g.default_domain_id and d.enabled and d.purpose = 'short_link'
  and exists(select 1 from domain_user_group dg where dg.domain_id = d.id and dg.user_group_id = g.id)
where u.id = $1 and u.status = 'active' and u.deleted_at is null
  and g.builtin and g.key in ('user', 'admin');

-- name: ClearDeletedGroupDomainDefaults :exec
with admin_lock as materialized (
    select id from user_group where builtin and key = 'admin' for update
), targets as materialized (
    select g.id from user_group g cross join admin_lock
    where g.default_domain_id = sqlc.arg(domain_id)
    order by case when g.key = 'admin' then 0 else 1 end, g.id
    for update of g
)
update user_group g
set default_domain_id = null,
    updated_at = greatest(clock_timestamp(), g.updated_at + interval '1 microsecond')
where g.id in (select id from targets);
