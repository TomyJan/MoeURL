-- name: GetDefaultShortLinkDomain :one
select id, host, display_name, purpose, enabled, is_default, created_at, updated_at
from domain
where enabled = true and is_default = true
limit 1;

-- name: GetGrantedShortLinkDomainForCreate :one
select domain.id, domain.host
from domain
join domain_user_group on domain_user_group.domain_id = domain.id
join user_group on user_group.id = domain_user_group.user_group_id
where domain.enabled and domain.purpose = 'short_link'
  and user_group.key = sqlc.arg(group_key) and user_group.builtin
  and user_group.permissions ? 'short_link:create'
  and user_group.permissions ? sqlc.arg(required_permission)::text
  and ((sqlc.arg(use_default)::boolean and domain.is_default)
       or (not sqlc.arg(use_default)::boolean and not domain.is_default
           and domain.id = sqlc.arg(domain_id)::uuid))
for share of domain, domain_user_group, user_group;

-- name: GetShortLinkDomainByID :one
select id, host from domain where id = $1;

-- name: CreateDomain :one
insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
values ($1, $2, $3, $4, $5, $6, now(), now())
returning id, host, display_name, purpose, enabled, is_default, created_at, updated_at;

-- name: ListManagedDomains :many
select domain.id, domain.host, domain.display_name, domain.purpose, domain.enabled,
       domain.is_default, domain.created_at, domain.updated_at,
       exists(select 1 from short_link where short_link.domain_id = domain.id) as referenced
from domain
where domain.purpose = 'short_link'
order by domain.is_default desc, domain.created_at, domain.id;

-- name: ListAvailableShortLinkDomains :many
select domain.id, domain.host, domain.display_name, domain.is_default
from domain
join domain_user_group on domain_user_group.domain_id = domain.id
join user_group on user_group.id = domain_user_group.user_group_id
where user_group.key = sqlc.arg(group_key)
  and user_group.builtin = true
  and domain.enabled = true and domain.purpose = 'short_link'
  and ((domain.is_default and sqlc.arg(can_default)::boolean)
       or (not domain.is_default and sqlc.arg(can_assigned)::boolean))
order by domain.is_default desc, domain.created_at, domain.id;

-- name: ListDomainGrantKeys :many
select user_group.key
from domain_user_group
join user_group on user_group.id = domain_user_group.user_group_id
where domain_user_group.domain_id = $1
order by user_group.key;

-- name: DeleteDomainGrants :exec
delete from domain_user_group where domain_id = $1;

-- name: InsertDomainGrant :execrows
insert into domain_user_group (domain_id, user_group_id)
select $1, user_group.id from user_group where user_group.key = $2 and user_group.builtin = true and user_group.key in ('user', 'admin');

-- name: ListDomainHosts :many
select id, host from domain;

-- name: GetManagedDomainForUpdate :one
select id, host, display_name, purpose, enabled, is_default, created_at, updated_at
from domain where id = $1 and purpose = 'short_link' for update;

-- name: DomainHasReferences :one
select exists(select 1 from short_link where domain_id = $1);

-- name: UpdateManagedDomain :one
update domain
set host = $2, display_name = $3, enabled = $4,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where domain.id = $1 and domain.purpose = 'short_link' and domain.updated_at = $5
returning domain.id, domain.host, domain.display_name, domain.purpose, domain.enabled,
    domain.is_default, domain.created_at, domain.updated_at;

-- name: ClearDefaultShortLinkDomain :exec
update domain set is_default = false,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where is_default = true and purpose = 'short_link';

-- name: MakeDefaultShortLinkDomain :one
update domain set is_default = true,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where domain.id = $1 and domain.enabled = true and domain.purpose = 'short_link' and domain.updated_at = $2
returning domain.id, domain.host, domain.display_name, domain.purpose, domain.enabled,
    domain.is_default, domain.created_at, domain.updated_at;

-- name: DeleteManagedDomain :execrows
delete from domain where domain.id = $1 and domain.purpose = 'short_link' and domain.is_default = false
    and domain.updated_at = $2 and not exists(select 1 from short_link where short_link.domain_id = $1);
