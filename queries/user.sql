-- name: GetUserByUsername :one
select id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at, deleted_at
from app_user
where username = $1 and deleted_at is null;

-- name: GetUserGroupByKey :one
select id, key, name, description, permissions, builtin, created_at, updated_at
from user_group
where key = $1;

-- name: GetUserGroupByID :one
select id, key, name, description, permissions, builtin, created_at, updated_at
from user_group
where id = $1;

-- name: ListBuiltinUserGroups :many
select id, key, name, description, permissions, builtin, created_at, updated_at
from user_group
where builtin = true
	and key in ('guest', 'user', 'admin')
order by case key
	when 'guest' then 1
	when 'user' then 2
	when 'admin' then 3
end;

-- name: UpdateBuiltinUserGroupPermissions :one
update user_group
set permissions = sqlc.arg(permissions)::jsonb,
	updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where key = sqlc.arg(group_key)
	and builtin = true
	and key in ('user', 'admin')
	and updated_at = sqlc.arg(expected_updated_at)
returning id, key, name, description, permissions, builtin, created_at, updated_at;

-- name: CreateUserGroup :one
insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
values ($1, $2, $3, $4, $5, $6, now(), now())
returning id, key, name, description, permissions, builtin, created_at, updated_at;

-- name: CreateAppUser :one
insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
values ($1, $2, $3, $4, $5, $6, $7, now(), now())
returning id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at, deleted_at;

-- name: CountAppUsers :one
select count(*)::bigint
from app_user
where deleted_at is null;

-- name: ListAppUsers :many
select app_user.id,
	app_user.username,
	app_user.nickname,
	user_group.key as group_key,
	app_user.status,
	app_user.builtin,
	app_user.created_at,
	app_user.updated_at
from app_user
join user_group on user_group.id = app_user.group_id
where app_user.deleted_at is null
order by app_user.created_at desc, app_user.username asc
limit $1 offset $2;

-- name: GetAppUserByID :one
select id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at, deleted_at
from app_user
where id = $1 and deleted_at is null;

-- name: GetAppUserMetaByID :one
select id, builtin, deleted_at
from app_user
where id = $1 and deleted_at is null;

-- name: UpdateAppUserNickname :one
update app_user
set nickname = $2,
	updated_at = now()
where id = $1 and deleted_at is null and builtin = false
returning id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at, deleted_at;

-- name: UpdateAppUserProfile :one
update app_user
set nickname = $2,
	status = $3,
	updated_at = now()
where id = $1 and deleted_at is null and builtin = false
returning id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at, deleted_at;

-- name: UpdateAppUserPassword :execrows
update app_user
set password_hash = $2,
	updated_at = now()
where id = $1 and deleted_at is null and builtin = false;
