-- name: LockBatchNoteClearPreview :many
select id, owner_id, updated_at, note_updated_at, (note <> '')::boolean as has_note
from short_link where id=any($1::uuid[]) and deleted_at is null
order by id for share;

-- name: LockBatchNoteClearTargets :many
select id, owner_id, updated_at, note_updated_at, (note <> '')::boolean as has_note
from short_link where id=any($1::uuid[]) and deleted_at is null
order by id for update;
