-- name: LockBatchTagsActor :one
select id, group_id, status, deleted_at from app_user where id=$1 for share;

-- name: LockBatchTagsShortLinks :many
select id, owner_id, updated_at, tags from short_link
where id=any($1::uuid[]) and deleted_at is null
order by id for update;

-- name: UpdateBatchTags :exec
update short_link set tags=$2,
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
where id=$1;
