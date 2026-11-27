-- name: CheckShortLinkNoteListActor :one
select sqlc.arg(permission_granted)::boolean as allowed;
