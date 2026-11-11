-- name: LockOwnShortLinkTargetForPolicy :one
select target_url from short_link where id=$1 and owner_id=$2 and deleted_at is null
for update;

-- name: LockAnyShortLinkTargetForPolicy :one
select target_url from short_link where id=$1 and deleted_at is null
for update;
