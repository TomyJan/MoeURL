-- name: BatchSetShortLinkStatus :one
WITH actor AS MATERIALIZED (
    SELECT u.id, g.permissions
    FROM app_user u JOIN user_group g ON g.id = u.group_id
    WHERE u.id = sqlc.arg(actor_id)::uuid
      AND u.status = 'active' AND u.deleted_at IS NULL
      AND g.key = sqlc.arg(group_key)::text
    FOR SHARE OF u, g
), authorized_actor AS MATERIALIZED (
    SELECT EXISTS (
        SELECT 1 FROM actor
        WHERE permissions ?& sqlc.arg(required_permissions)::text[]
    ) AS authorized
), targets AS MATERIALIZED (
    SELECT s.id
    FROM short_link s
    WHERE (SELECT authorized FROM authorized_actor)
      AND s.id = ANY(sqlc.arg(ids)::uuid[]) AND s.deleted_at IS NULL
      AND (sqlc.arg(admin_scope)::boolean OR s.owner_id = sqlc.arg(actor_id)::uuid)
    ORDER BY s.id
    FOR UPDATE OF s
), changed AS (
    UPDATE short_link s
    SET status = sqlc.arg(status)::text, updated_at = now()
    FROM targets
    WHERE s.id = targets.id
      AND (SELECT count(*) FROM targets) = cardinality(sqlc.arg(ids)::uuid[])
    RETURNING s.id
)
SELECT (SELECT authorized FROM authorized_actor)::boolean AS authorized,
       (SELECT count(*) FROM changed)::bigint AS affected_count;

-- name: BatchDeleteShortLinks :one
WITH actor AS MATERIALIZED (
    SELECT u.id, g.permissions
    FROM app_user u JOIN user_group g ON g.id = u.group_id
    WHERE u.id = sqlc.arg(actor_id)::uuid
      AND u.status = 'active' AND u.deleted_at IS NULL
      AND g.key = sqlc.arg(group_key)::text
    FOR SHARE OF u, g
), authorized_actor AS MATERIALIZED (
    SELECT EXISTS (
        SELECT 1 FROM actor
        WHERE permissions ?& sqlc.arg(required_permissions)::text[]
    ) AS authorized
), targets AS MATERIALIZED (
    SELECT s.id
    FROM short_link s
    WHERE (SELECT authorized FROM authorized_actor)
      AND s.id = ANY(sqlc.arg(ids)::uuid[]) AND s.deleted_at IS NULL
      AND (sqlc.arg(admin_scope)::boolean OR s.owner_id = sqlc.arg(actor_id)::uuid)
    ORDER BY s.id
    FOR UPDATE OF s
), changed AS (
    UPDATE short_link s
    SET deleted_at = now(), updated_at = now()
    FROM targets
    WHERE s.id = targets.id
      AND (SELECT count(*) FROM targets) = cardinality(sqlc.arg(ids)::uuid[])
    RETURNING s.id
)
SELECT (SELECT authorized FROM authorized_actor)::boolean AS authorized,
       (SELECT count(*) FROM changed)::bigint AS affected_count;
