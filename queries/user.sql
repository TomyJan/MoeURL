-- name: GetUserByUsername :one
select id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at, deleted_at
from app_user
where username = $1 and deleted_at is null;

-- name: GetUserGroupByKey :one
select id, key, name, description, permissions, builtin, created_at, updated_at
from user_group
where key = $1;

-- name: CreateUserGroup :one
insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
values ($1, $2, $3, $4, $5, $6, now(), now())
returning id, key, name, description, permissions, builtin, created_at, updated_at;

-- name: CreateAppUser :one
insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
values ($1, $2, $3, $4, $5, $6, $7, now(), now())
returning id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at, deleted_at;
