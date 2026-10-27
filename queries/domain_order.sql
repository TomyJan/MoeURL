-- name: LockDomainOrderActor :one
select id, group_id from app_user
where id = $1 and status = 'active' and deleted_at is null
for share;

-- name: LockDomainOrderGroup :one
select permissions from user_group
where id = $1 and builtin and key = 'admin'
for share;

-- name: SetDomainSortOrder :one
update domain
set sort_order = $2,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where id = $1 and purpose = 'short_link' and updated_at = $3
returning id, host, display_name, purpose, enabled, is_default, created_at, updated_at, sort_order, default_redirect_mode;
