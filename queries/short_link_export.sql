-- name: ExportShortLinkList :many
with selection_input as materialized (
    select sqlc.arg('selection_mode')::boolean as enabled,
        sqlc.arg('selected_ids')::uuid[] as ids
), selection_guard as materialized (
    select enabled, ids, (not enabled or coalesce(
        cardinality(ids) between 1 and 100
        and array_position(ids, null) is null
        and not ('00000000-0000-0000-0000-000000000000'::uuid = any(ids))
        and (select count(distinct selected_id) from unnest(ids) as selected_id) = cardinality(ids), false)
    )::boolean as valid
    from selection_input
), grant_snapshot as (
    select sqlc.arg(permission_granted)::boolean as allowed
), candidates as materialized (
    -- Retain bounded IDs/order/size metadata, never the possibly large text values.
    select short_link.id, short_link.created_at,
        octet_length(domain.host)::bigint + octet_length(short_link.slug)::bigint
        + octet_length(short_link.target_url)::bigint + octet_length(short_link.title)::bigint
        + coalesce((select sum(octet_length(tag_value)::bigint) from unnest(short_link.tags) as tag_value), 0)
        + octet_length(short_link.status)::bigint + octet_length(short_link.redirect_mode)::bigint
        + octet_length(owner.username)::bigint as text_bytes
    from short_link
    join domain on domain.id = short_link.domain_id
    join app_user as owner on owner.id = short_link.owner_id
    cross join grant_snapshot
    cross join selection_guard
    where grant_snapshot.allowed and selection_guard.valid and short_link.deleted_at is null
        and (not selection_guard.enabled or short_link.id = any(selection_guard.ids))
        and (sqlc.arg('is_admin')::boolean or short_link.owner_id = sqlc.arg('actor_id')::uuid)
        and (sqlc.arg('status')::text = '' or short_link.status = sqlc.arg('status')::text)
        and (sqlc.arg('tag')::text = '' or short_link.tags @> array[sqlc.arg('tag')::text])
        and (sqlc.arg('note_status')::text = ''
            or (sqlc.arg('note_status')::text = 'present' and short_link.note <> '')
            or (sqlc.arg('note_status')::text = 'absent' and short_link.note = ''))
        and (sqlc.arg('note_query')::text = '' or strpos(lower(short_link.note), lower(sqlc.arg('note_query')::text)) > 0)
        and (
            sqlc.arg('query')::text = ''
            or short_link.slug ilike '%' || sqlc.arg('query')::text || '%'
            or short_link.target_url ilike '%' || sqlc.arg('query')::text || '%'
            or (sqlc.arg('is_admin')::boolean and owner.username ilike '%' || sqlc.arg('query')::text || '%')
            or short_link.title ilike '%' || sqlc.arg('query')::text || '%'
            or exists (select 1 from unnest(short_link.tags) as tag_value where tag_value ilike '%' || sqlc.arg('query')::text || '%')
            or (sqlc.arg('is_admin')::boolean and owner.nickname ilike '%' || sqlc.arg('query')::text || '%')
        )
    order by short_link.created_at desc, short_link.id desc
    limit 1001
), candidate_budget as materialized (
    select count(*) as row_count,
        (count(*) > 1000 or coalesce(sum(text_bytes), 0) > 8388608)::boolean as limit_exceeded
    from candidates
), read_budget as materialized (
    select candidate_budget.limit_exceeded,
        (selection_guard.enabled and (not selection_guard.valid
            or candidate_budget.row_count <> coalesce(cardinality(selection_guard.ids), 0)))::boolean as selection_unavailable
    from candidate_budget cross join selection_guard
)
select grant_snapshot.allowed, read_budget.limit_exceeded, read_budget.selection_unavailable,
    coalesce(links.id::text, '')::text as id,
    coalesce(links.domain_host, '')::text as domain_host,
    coalesce(links.slug, '')::text as slug,
    coalesce(links.target_url, '')::text as target_url,
    coalesce(links.title, '')::text as title,
    coalesce(links.tags, '{}')::text[] as tags,
    coalesce(links.status, '')::text as status,
    coalesce(links.redirect_mode, '')::text as redirect_mode,
    coalesce(links.intermediate_delay_seconds, 0)::smallint as intermediate_delay_seconds,
    links.expires_at::timestamptz as expires_at,
    coalesce(links.password_enabled, false)::boolean as password_enabled,
    coalesce(links.max_visits, 0)::bigint as max_visits,
    coalesce(links.visits_used, 0)::bigint as visits_used,
    links.created_at::timestamptz as created_at,
    links.updated_at::timestamptz as updated_at,
    coalesce(links.owner_id::text, '')::text as owner_id,
    coalesce(links.owner_username, '')::text as owner_username
from grant_snapshot
cross join read_budget
left join lateral (
    select short_link.id, domain.host as domain_host, short_link.slug, short_link.target_url,
        short_link.title, short_link.tags, short_link.status, short_link.redirect_mode,
        short_link.intermediate_delay_seconds, short_link.expires_at,
        coalesce(short_link.password_hash, '') <> '' as password_enabled,
        short_link.max_visits, short_link.visits_used, short_link.created_at, short_link.updated_at,
        short_link.owner_id, owner.username as owner_username
    from candidates
    join short_link on short_link.id = candidates.id
    join domain on domain.id = short_link.domain_id
    join app_user as owner on owner.id = short_link.owner_id
    where not read_budget.limit_exceeded and not read_budget.selection_unavailable
) as links on true
order by links.created_at desc, links.id desc;
