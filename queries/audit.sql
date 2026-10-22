-- name: ListAuditLogs :many
select audit_log.id, audit_log.actor_id, app_user.username as actor_username,
       audit_log.resource_type, audit_log.resource_id, audit_log.action, audit_log.changed_fields, audit_log.created_at
from audit_log left join app_user on app_user.id = audit_log.actor_id
where audit_log.created_at >= sqlc.arg(start_at)::timestamptz
and audit_log.created_at < sqlc.arg(end_at)::timestamptz
and audit_log.created_at >= sqlc.arg(retention_cutoff)::timestamptz
and (sqlc.arg(actor_id)::text = '' or audit_log.actor_id::text = sqlc.arg(actor_id)::text)
and (sqlc.arg(resource_type)::text = '' or audit_log.resource_type = sqlc.arg(resource_type)::text)
and (sqlc.arg(action)::text = '' or audit_log.action = sqlc.arg(action)::text)
and (not sqlc.arg(has_cursor)::boolean or (audit_log.created_at,audit_log.id) < (sqlc.arg(cursor_time)::timestamptz,sqlc.arg(cursor_id)::bigint))
order by audit_log.created_at desc, audit_log.id desc
limit sqlc.arg(page_limit);

-- name: DeleteExpiredAuditLogs :execrows
delete from audit_log where id in (
    select id from audit_log where created_at < now() - interval '4320 hours'
    order by created_at, id limit 500 for update skip locked
);
