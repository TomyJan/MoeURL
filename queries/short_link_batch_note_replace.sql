-- name: LockBatchNoteReplacePreview :many
select id, owner_id, updated_at, note_updated_at, (note <> sqlc.arg(replacement)::text)::boolean as will_change
from short_link where id=any(sqlc.arg(ids)::uuid[]) and deleted_at is null
order by id for share;

-- name: LockBatchNoteReplaceTargets :many
select id, owner_id, updated_at, note_updated_at, (note <> sqlc.arg(replacement)::text)::boolean as will_change
from short_link where id=any(sqlc.arg(ids)::uuid[]) and deleted_at is null
order by id for update;
