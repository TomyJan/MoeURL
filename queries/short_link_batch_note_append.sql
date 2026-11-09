-- name: LockBatchNoteAppendActor :one
select id, group_id, status, deleted_at from app_user where id=$1 for update;

-- name: LockBatchNoteAppendPreview :many
select id, owner_id, updated_at, note_updated_at,
    (note = '' or char_length(note) + 1 + char_length(sqlc.arg(append_text)::text) <= 1000)::boolean as can_append
from short_link where id=any(sqlc.arg(ids)::uuid[]) and deleted_at is null
order by id for share;

-- name: LockBatchNoteAppendTargets :many
select id, owner_id, updated_at, note_updated_at,
    (note = '' or char_length(note) + 1 + char_length(sqlc.arg(append_text)::text) <= 1000)::boolean as can_append
from short_link where id=any(sqlc.arg(ids)::uuid[]) and deleted_at is null
order by id for update;

-- name: ReadBatchNoteAppendReceipt :one
select request_hash, appended_count from short_link_note_append_batch
where actor_id=$1 and request_id=$2 for update;

-- name: InsertBatchNoteAppendReceipt :exec
insert into short_link_note_append_batch(actor_id,request_id,request_hash,appended_count)
values($1,$2,$3,$4);

-- name: AppendShortLinkNote :one
update short_link set note=case when note='' then $2 else note || E'\n' || $2 end,
    note_updated_at=greatest(clock_timestamp(),note_updated_at+interval '1 microsecond')
where id=$1 returning id,note_updated_at;
