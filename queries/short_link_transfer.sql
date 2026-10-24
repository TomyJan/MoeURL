-- name: LockTransferUsers :many
select app_user.id, app_user.username, app_user.status, app_user.deleted_at,
    app_user.group_id, user_group.key as group_key
from app_user join user_group on user_group.id=app_user.group_id
where app_user.id=sqlc.arg(actor_id)::uuid or app_user.username=sqlc.arg(username)::text
order by app_user.id for update of app_user;

-- name: LockTransferActorGroup :one
select key, permissions from user_group where id=$1 for share;

-- name: LockTransferShortLink :one
select id, owner_id, updated_at from short_link
where id=$1 and deleted_at is null for update;

-- name: TransferShortLinkOwner :one
update short_link set owner_id=$2,
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
where id=$1 returning id, owner_id, updated_at;

-- name: LockBatchTransferShortLinks :many
select id, owner_id, updated_at from short_link
where id=any($1::uuid[]) and deleted_at is null
order by id for update;
