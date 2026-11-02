-- name: ListAdminTagCatalog :many
with grant_snapshot as materialized (
    select exists (
        select 1 from app_user
        join user_group on user_group.id = app_user.group_id
        where app_user.id = sqlc.arg('actor_id')::uuid
            and app_user.status = 'active' and app_user.deleted_at is null
            and user_group.key <> 'guest'
            and user_group.permissions ? 'admin:access'
            and user_group.permissions ? 'short_link:read_all'
    )::boolean as allowed
), catalog as (
    select tag_value::text as tag, count(distinct short_link.id)::bigint as link_count
    from short_link
    cross join grant_snapshot
    cross join lateral unnest(short_link.tags) as tag_value
    where grant_snapshot.allowed
        and short_link.deleted_at is null
        and strpos(tag_value, sqlc.arg('query')::text) > 0
    group by tag_value
    order by link_count desc, tag_value collate "C" asc
    limit 51
)
select grant_snapshot.allowed,
    coalesce(catalog.tag, '')::text as tag,
    coalesce(catalog.link_count, 0)::bigint as link_count
from grant_snapshot
left join catalog on true
order by catalog.link_count desc, catalog.tag collate "C" asc;
