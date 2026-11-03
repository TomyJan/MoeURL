-- name: ReadShortLinkNote :one
with grant_snapshot as materialized (
    select exists (
        select 1 from app_user u join user_group g on g.id=u.group_id
        where u.id=sqlc.arg(actor_id)::uuid and u.status='active' and u.deleted_at is null
            and g.key <> 'guest'
            and (case when sqlc.arg(admin_scope)::boolean
                then g.permissions ? 'admin:access' and g.permissions ? 'short_link:read_all'
                else g.permissions ? 'short_link:read_own' end)
    )::boolean as allowed
)
select grant_snapshot.allowed, (l.id is not null)::boolean as found,
    coalesce(l.id::text,'')::text as id, coalesce(l.note,'')::text as note,
    coalesce(l.note_updated_at,'epoch'::timestamptz)::timestamptz as note_updated_at
from grant_snapshot
left join short_link l on grant_snapshot.allowed and l.id=sqlc.arg(link_id)::uuid
    and l.deleted_at is null and (sqlc.arg(admin_scope)::boolean or l.owner_id=sqlc.arg(actor_id)::uuid);

-- name: LockShortLinkNote :one
select id, owner_id, note, note_updated_at from short_link
where id=$1 and deleted_at is null for update;

-- name: UpdateShortLinkNote :one
update short_link set note=$2,
    note_updated_at=greatest(clock_timestamp(),note_updated_at+interval '1 microsecond')
where id=$1 returning id, note, note_updated_at;
