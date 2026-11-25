-- name: GetUserByUsername :one
select id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at, deleted_at
from app_user
where username = $1 and deleted_at is null;

-- name: GetUserGroupByKey :one
select id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id
from user_group
where key = $1;

-- name: GetUserGroupByID :one
select id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id
from user_group
where id = $1;

-- name: LockUserGroupForCustomManagement :one
select id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id
from user_group
where key = $1
for update;

-- name: ListBuiltinUserGroups :many
select id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id
from user_group
where builtin = true
	and key in ('guest', 'user', 'admin')
order by case key
	when 'guest' then 1
	when 'user' then 2
	when 'admin' then 3
end;

-- name: ListUserGroups :many
select user_group.id, user_group.key, user_group.name, user_group.description,
	user_group.permissions, user_group.builtin, user_group.created_at, user_group.updated_at,
	user_group.default_domain_id,
	(select count(*)::bigint
	 from app_user
	 where app_user.group_id = user_group.id
		or exists (
			select 1 from app_user_group_membership
			where app_user_group_membership.user_id = app_user.id
				and app_user_group_membership.user_group_id = user_group.id
		)
	) as member_count
from user_group
order by user_group.builtin desc,
	case user_group.key when 'guest' then 1 when 'user' then 2 when 'admin' then 3 else 4 end,
	lower(btrim(user_group.name)), user_group.id;

-- name: CreateCustomUserGroup :one
insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
values (sqlc.arg(id), sqlc.arg(group_key), sqlc.arg(name), sqlc.arg(description), '[]'::jsonb, false, clock_timestamp(), clock_timestamp())
returning id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id;

-- name: UpdateCustomUserGroupDetails :one
update user_group
set name = sqlc.arg(name),
	description = sqlc.arg(description),
	updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where key = sqlc.arg(group_key) and builtin = false and updated_at = sqlc.arg(expected_updated_at)
returning id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id;

-- name: UpdateCustomUserGroupPermissions :one
update user_group
set permissions = sqlc.arg(permissions)::jsonb,
	updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where key = sqlc.arg(group_key) and builtin = false and updated_at = sqlc.arg(expected_updated_at)
returning id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id;

-- name: DeleteCustomUserGroup :one
delete from user_group
where key = $1 and builtin = false
	and not exists (
		select 1 from app_user_group_membership
		where app_user_group_membership.user_group_id = user_group.id
	)
	and not exists (select 1 from app_user where app_user.group_id = user_group.id)
returning id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id;

-- name: UpdateBuiltinUserGroupPermissions :one
update user_group
set permissions = sqlc.arg(permissions)::jsonb,
	updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where key = sqlc.arg(group_key)
	and builtin = true
	and key in ('user', 'admin')
	and updated_at = sqlc.arg(expected_updated_at)
returning id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id;

-- name: CreateUserGroup :one
insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
values ($1, $2, $3, $4, $5, $6, now(), now())
returning id, key, name, description, permissions, builtin, created_at, updated_at, default_domain_id;

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
	coalesce((
		select jsonb_agg(jsonb_build_object('key', supplemental_group.key, 'name', supplemental_group.name) order by supplemental_group.key)
		from app_user_group_membership as membership
		join user_group as supplemental_group on supplemental_group.id = membership.user_group_id
		where membership.user_id = app_user.id
	), '[]'::jsonb)::text as supplemental_groups,
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

-- name: GetSupplementalUserGroupsByID :many
select user_group.key, user_group.name
from app_user_group_membership
join user_group on user_group.id = app_user_group_membership.user_group_id
where app_user_group_membership.user_id = $1
order by user_group.key;

-- name: GetSupplementalUserGroupKeysByUserID :many
select user_group.key
from app_user_group_membership
join user_group on user_group.id = app_user_group_membership.user_group_id
where app_user_group_membership.user_id = $1
order by user_group.key;

-- name: DeleteSupplementalUserGroupMembershipsByUserID :exec
delete from app_user_group_membership
where user_id = $1;

-- name: CreateSupplementalUserGroupMembership :exec
insert into app_user_group_membership (user_id, user_group_id)
values ($1, $2);

-- name: UpdateAppUserMembershipRevision :one
update app_user
set updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where id = sqlc.arg(id) and deleted_at is null and builtin = false
	and updated_at = sqlc.arg(expected_updated_at)
returning *;

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

-- name: LockGroupChangeUsers :many
select * from app_user
where id = any(sqlc.arg(ids)::uuid[])
order by id for update;

-- name: LockGroupChangeGroup :one
select * from user_group where key = $1 for no key update;

-- name: ChangeAppUserGroup :one
update app_user set group_id=$2,
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
where id=$1 and deleted_at is null and builtin=false
returning *;

-- name: RevokeGroupChangeSessions :exec
update session set revoked_at=clock_timestamp()
where user_id=$1 and revoked_at is null;
