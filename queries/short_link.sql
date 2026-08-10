-- name: GetDatabaseTime :one
select clock_timestamp()::timestamptz as database_time;

-- name: CreateShortLink :one
insert into short_link (
    id, owner_id, domain_id, slug, target_url, status,
    redirect_mode, intermediate_delay_seconds, expires_at, password_hash,
    password_updated_at,
    created_at, updated_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    case when $10::text is null then null else clock_timestamp() end,
    now(), now())
returning id, owner_id, domain_id, slug, target_url, status,
    redirect_mode, intermediate_delay_seconds, expires_at,
    coalesce(expires_at <= clock_timestamp(), false)::boolean as expired,
    password_hash,
    created_at, updated_at, deleted_at;

-- name: GetShortLinkBySlug :one
select id, owner_id, domain_id, slug, target_url, status,
    redirect_mode, intermediate_delay_seconds, expires_at,
    coalesce(expires_at <= clock_timestamp(), false)::boolean as expired,
    password_hash,
    created_at, updated_at, deleted_at
from short_link
where slug = $1 and deleted_at is null;

-- name: GetShortLinkAnalyticsLink :one
select short_link.id,
    short_link.owner_id,
    short_link.slug,
    short_link.target_url,
    short_link.status,
    short_link.redirect_mode,
    short_link.intermediate_delay_seconds,
    short_link.expires_at,
    coalesce(short_link.expires_at <= clock_timestamp(), false)::boolean as expired,
    short_link.password_hash,
    short_link.created_at,
    domain.host as domain_host
from short_link
join domain on domain.id = short_link.domain_id
where short_link.id = $1 and short_link.deleted_at is null;

-- name: ListShortLinksByOwner :many
select short_link.id,
    short_link.owner_id,
    short_link.domain_id,
    short_link.slug,
    short_link.target_url,
    short_link.status,
    short_link.redirect_mode,
    short_link.intermediate_delay_seconds,
    short_link.expires_at,
    coalesce(short_link.expires_at <= clock_timestamp(), false)::boolean as expired,
    short_link.password_hash,
    short_link.created_at,
    short_link.updated_at,
    short_link.deleted_at,
    domain.host as domain_host,
    coalesce(stats.visit_count, 0)::bigint as visit_count,
    coalesce(stats.today_visit_count, 0)::bigint as today_visit_count,
    stats.last_visited_at::timestamptz as last_visited_at
from short_link
join domain on domain.id = short_link.domain_id
left join lateral (
    select count(*) filter (where event_type = 'redirect_response_sent')::bigint as visit_count,
        count(*) filter (where event_type = 'redirect_response_sent' and created_at >= current_date)::bigint as today_visit_count,
        max(created_at) filter (where event_type = 'redirect_response_sent') as last_visited_at
    from short_link_event
    where short_link_event.short_link_id = short_link.id
) stats on true
where short_link.owner_id = $1 and short_link.deleted_at is null
    and (sqlc.narg('status')::text is null or short_link.status = sqlc.narg('status')::text)
order by short_link.created_at desc
limit $2 offset $3;

-- name: CountShortLinksByOwner :one
select count(*)
from short_link
where owner_id = $1 and deleted_at is null
    and (sqlc.narg('status')::text is null or status = sqlc.narg('status')::text);

-- name: GetShortLinkOverviewByOwner :one
select count(distinct short_link.id)::bigint as total_link_count,
    count(distinct short_link.id) filter (where short_link.status = 'active')::bigint as active_link_count,
    count(short_link_event.id) filter (where short_link_event.event_type = 'redirect_response_sent')::bigint as visit_count,
    count(short_link_event.id) filter (
        where short_link_event.event_type = 'redirect_response_sent'
            and short_link_event.created_at >= current_date
            and short_link_event.created_at < current_date + interval '1 day'
    )::bigint as today_visit_count
from short_link
left join short_link_event on short_link_event.short_link_id = short_link.id
where short_link.owner_id = $1
    and short_link.deleted_at is null;

-- name: UpdateOwnShortLink :one
with locked as materialized (
    select short_link.id
    from short_link
    where short_link.id = sqlc.arg('id')
        and short_link.owner_id = sqlc.arg('owner_id')
        and short_link.deleted_at is null
    for update
)
update short_link
set target_url = coalesce(sqlc.narg('target_url'), target_url),
    status = coalesce(sqlc.narg('status'), status),
    redirect_mode = coalesce(sqlc.narg('redirect_mode')::text, redirect_mode),
    intermediate_delay_seconds = coalesce(sqlc.narg('intermediate_delay_seconds')::smallint, intermediate_delay_seconds),
    expires_at = case sqlc.arg('expiration_mode')::text
        when 'never' then null
        when 'at' then sqlc.narg('expires_at')::timestamptz
        else expires_at
    end,
    password_hash = case
        when sqlc.arg('password_mode')::text = 'never' then null
        when sqlc.arg('password_mode')::text = 'set' and coalesce(sqlc.narg('password_hash')::text, '') <> ''
            then sqlc.narg('password_hash')::text
        else password_hash
    end,
    password_updated_at = case
        when sqlc.arg('password_mode')::text = 'never'
            or (sqlc.arg('password_mode')::text = 'set' and coalesce(sqlc.narg('password_hash')::text, '') <> '')
            then clock_timestamp()
        else password_updated_at
    end,
    password_failed_attempts = case
        when sqlc.arg('password_mode')::text = 'never'
            or (sqlc.arg('password_mode')::text = 'set' and coalesce(sqlc.narg('password_hash')::text, '') <> '')
            then 0
        else password_failed_attempts
    end,
    password_window_started_at = case
        when sqlc.arg('password_mode')::text = 'never'
            or (sqlc.arg('password_mode')::text = 'set' and coalesce(sqlc.narg('password_hash')::text, '') <> '')
            then null
        else password_window_started_at
    end,
    password_blocked_until = case
        when sqlc.arg('password_mode')::text = 'never'
            or (sqlc.arg('password_mode')::text = 'set' and coalesce(sqlc.narg('password_hash')::text, '') <> '')
            then null
        else password_blocked_until
    end,
    updated_at = now()
from locked
where short_link.id = locked.id
returning short_link.id, short_link.owner_id, short_link.domain_id, short_link.slug, short_link.target_url, short_link.status,
    short_link.redirect_mode, short_link.intermediate_delay_seconds, short_link.expires_at,
    coalesce(short_link.expires_at <= clock_timestamp(), false)::boolean as expired,
    short_link.password_hash, short_link.password_updated_at,
    short_link.created_at, short_link.updated_at, short_link.deleted_at;

-- name: SoftDeleteOwnShortLink :execrows
update short_link
set deleted_at = now(),
    updated_at = now()
where id = $1
    and owner_id = $2
    and deleted_at is null;

-- name: ListAllShortLinks :many
select short_link.id,
    short_link.owner_id,
    short_link.domain_id,
    short_link.slug,
    short_link.target_url,
    short_link.status,
    short_link.redirect_mode,
    short_link.intermediate_delay_seconds,
    short_link.expires_at,
    coalesce(short_link.expires_at <= clock_timestamp(), false)::boolean as expired,
    short_link.password_hash,
    short_link.created_at,
    short_link.updated_at,
    short_link.deleted_at,
    domain.host as domain_host,
    app_user.username as owner_username,
    app_user.nickname as owner_nickname,
    coalesce(stats.visit_count, 0)::bigint as visit_count,
    coalesce(stats.today_visit_count, 0)::bigint as today_visit_count,
    stats.last_visited_at::timestamptz as last_visited_at
from short_link
join domain on domain.id = short_link.domain_id
join app_user on app_user.id = short_link.owner_id
left join lateral (
    select count(*) filter (where event_type = 'redirect_response_sent')::bigint as visit_count,
        count(*) filter (where event_type = 'redirect_response_sent' and created_at >= current_date)::bigint as today_visit_count,
        max(created_at) filter (where event_type = 'redirect_response_sent') as last_visited_at
    from short_link_event
    where short_link_event.short_link_id = short_link.id
) stats on true
where short_link.deleted_at is null
    and (sqlc.narg('status')::text is null or short_link.status = sqlc.narg('status')::text)
    and (
        sqlc.arg('query')::text = ''
        or short_link.slug ilike '%' || sqlc.arg('query')::text || '%'
        or short_link.target_url ilike '%' || sqlc.arg('query')::text || '%'
        or app_user.username ilike '%' || sqlc.arg('query')::text || '%'
        or app_user.nickname ilike '%' || sqlc.arg('query')::text || '%'
    )
order by short_link.created_at desc
limit $1 offset $2;

-- name: CountAllShortLinks :one
select count(*)
from short_link
left join app_user on sqlc.arg('query')::text <> '' and app_user.id = short_link.owner_id
where short_link.deleted_at is null
    and (sqlc.narg('status')::text is null or short_link.status = sqlc.narg('status')::text)
    and (
        sqlc.arg('query')::text = ''
        or short_link.slug ilike '%' || sqlc.arg('query')::text || '%'
        or short_link.target_url ilike '%' || sqlc.arg('query')::text || '%'
        or app_user.username ilike '%' || sqlc.arg('query')::text || '%'
        or app_user.nickname ilike '%' || sqlc.arg('query')::text || '%'
    );

-- name: UpdateAnyShortLink :one
with locked as materialized (
    select short_link.id
    from short_link
    where short_link.id = sqlc.arg('id')
        and short_link.deleted_at is null
    for update
)
update short_link
set target_url = coalesce(sqlc.narg('target_url'), target_url),
    status = coalesce(sqlc.narg('status'), status),
    redirect_mode = coalesce(sqlc.narg('redirect_mode')::text, redirect_mode),
    intermediate_delay_seconds = coalesce(sqlc.narg('intermediate_delay_seconds')::smallint, intermediate_delay_seconds),
    expires_at = case sqlc.arg('expiration_mode')::text
        when 'never' then null
        when 'at' then sqlc.narg('expires_at')::timestamptz
        else expires_at
    end,
    password_hash = case
        when sqlc.arg('password_mode')::text = 'never' then null
        when sqlc.arg('password_mode')::text = 'set' and coalesce(sqlc.narg('password_hash')::text, '') <> ''
            then sqlc.narg('password_hash')::text
        else password_hash
    end,
    password_updated_at = case
        when sqlc.arg('password_mode')::text = 'never'
            or (sqlc.arg('password_mode')::text = 'set' and coalesce(sqlc.narg('password_hash')::text, '') <> '')
            then clock_timestamp()
        else password_updated_at
    end,
    password_failed_attempts = case
        when sqlc.arg('password_mode')::text = 'never'
            or (sqlc.arg('password_mode')::text = 'set' and coalesce(sqlc.narg('password_hash')::text, '') <> '')
            then 0
        else password_failed_attempts
    end,
    password_window_started_at = case
        when sqlc.arg('password_mode')::text = 'never'
            or (sqlc.arg('password_mode')::text = 'set' and coalesce(sqlc.narg('password_hash')::text, '') <> '')
            then null
        else password_window_started_at
    end,
    password_blocked_until = case
        when sqlc.arg('password_mode')::text = 'never'
            or (sqlc.arg('password_mode')::text = 'set' and coalesce(sqlc.narg('password_hash')::text, '') <> '')
            then null
        else password_blocked_until
    end,
    updated_at = now()
from locked
where short_link.id = locked.id
returning short_link.id, short_link.owner_id, short_link.domain_id, short_link.slug, short_link.target_url, short_link.status,
    short_link.redirect_mode, short_link.intermediate_delay_seconds, short_link.expires_at,
    coalesce(short_link.expires_at <= clock_timestamp(), false)::boolean as expired,
    short_link.password_hash, short_link.password_updated_at,
    short_link.created_at, short_link.updated_at, short_link.deleted_at;

-- name: SoftDeleteAnyShortLink :execrows
update short_link
set deleted_at = now(),
    updated_at = now()
where id = $1
    and deleted_at is null;

-- name: GetShortLinkPasswordStateForUpdate :one
select id, password_hash, password_failed_attempts, password_window_started_at,
    password_blocked_until, password_updated_at
from short_link
where id = $1 and deleted_at is null
for update;

-- name: GetShortLinkPasswordStateBySlugForUpdate :one
select id, password_hash, password_failed_attempts, password_window_started_at,
    password_blocked_until, password_updated_at
from short_link
where slug = $1 and deleted_at is null
for update;

-- name: RecordShortLinkPasswordFailure :exec
update short_link
set password_failed_attempts = $2,
    password_window_started_at = $3,
    password_blocked_until = $4
where id = $1 and deleted_at is null;

-- name: ResetShortLinkPasswordFailures :exec
update short_link
set password_failed_attempts = 0,
    password_window_started_at = null,
    password_blocked_until = null
where id = $1 and deleted_at is null;

-- name: CreateShortLinkAccessGrant :one
insert into short_link_access_grant (id, short_link_id, token_hash, expires_at, created_at)
values ($1, $2, $3, $4, clock_timestamp())
returning id, short_link_id, token_hash, expires_at, created_at;

-- name: DeleteExpiredShortLinkAccessGrants :execrows
with expired_grant as (
    select id
    from short_link_access_grant
    where expires_at <= clock_timestamp()
    order by expires_at
    limit sqlc.arg(batch_size)::bigint
    for update skip locked
)
delete from short_link_access_grant as access_grant
using expired_grant
where access_grant.id = expired_grant.id;

-- name: GetValidShortLinkAccessGrant :one
select access_grant.id, access_grant.short_link_id, access_grant.token_hash,
    access_grant.expires_at, access_grant.created_at
from short_link_access_grant as access_grant
join short_link on short_link.id = access_grant.short_link_id
where access_grant.short_link_id = $1
    and access_grant.token_hash = $2
    and access_grant.expires_at > clock_timestamp()
    and (short_link.password_updated_at is null or access_grant.created_at >= short_link.password_updated_at);
