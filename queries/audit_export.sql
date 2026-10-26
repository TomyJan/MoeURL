-- name: ExportAuditLogs :many
with candidates as materialized (
    select a.id, a.created_at,
        coalesce(octet_length(u.username)::bigint, 0)
        + octet_length(a.resource_type)::bigint
        + octet_length(a.resource_id)::bigint
        + octet_length(a.action)::bigint
        + octet_length(to_json(a.changed_fields)::text)::bigint as text_bytes
    from audit_log a left join app_user u on u.id = a.actor_id
    where a.created_at >= sqlc.arg(start_at)::timestamptz
        and a.created_at < sqlc.arg(end_at)::timestamptz
        and a.created_at >= sqlc.arg(retention_cutoff)::timestamptz
        and (sqlc.arg(actor_id)::text = '' or a.actor_id::text = sqlc.arg(actor_id)::text)
        and (sqlc.arg(resource_type)::text = '' or a.resource_type = sqlc.arg(resource_type)::text)
        and (sqlc.arg(action)::text = '' or a.action = sqlc.arg(action)::text)
    order by a.created_at desc, a.id desc limit 1001
), budget as materialized (
    select count(*) > 1000 or coalesce(sum(text_bytes), 0) > 8388608 as limit_exceeded from candidates
), records as materialized (
    select a.id, a.created_at, a.actor_id, u.username as actor_username,
        a.resource_type, a.resource_id, a.action, to_json(a.changed_fields)::text as changed_fields
    from budget b cross join candidates c join audit_log a on a.id = c.id
    left join app_user u on u.id = a.actor_id
    where not b.limit_exceeded
)
select b.limit_exceeded::boolean as limit_exceeded, coalesce(r.id::text, '')::text as id, r.created_at,
    coalesce(r.actor_id::text, '')::text as actor_id, coalesce(r.actor_username, '')::text as actor_username,
    coalesce(r.resource_type, '')::text as resource_type, coalesce(r.resource_id, '')::text as resource_id,
    coalesce(r.action, '')::text as action, coalesce(r.changed_fields, '')::text as changed_fields
from budget b left join records r on true order by r.created_at desc, r.id desc;
