-- name: CheckShortLinkNoteListActor :one
select exists (
    select 1 from app_user u join user_group g on g.id=u.group_id
    where u.id=sqlc.arg(actor_id)::uuid and u.status='active' and u.deleted_at is null
        and g.key <> 'guest'
        and (case when sqlc.arg(admin_scope)::boolean
            then g.permissions ? 'admin:access' and g.permissions ? 'short_link:read_all'
            else g.permissions ? 'short_link:read_own' end)
)::boolean as allowed;
