-- name: CreateShortLink :one
insert into short_link (id, owner_id, domain_id, slug, target_url, status, created_at, updated_at)
values ($1, $2, $3, $4, $5, $6, now(), now())
returning id, owner_id, domain_id, slug, target_url, status, created_at, updated_at, deleted_at;

-- name: GetShortLinkBySlug :one
select id, owner_id, domain_id, slug, target_url, status, created_at, updated_at, deleted_at
from short_link
where slug = $1 and deleted_at is null;

-- name: ListShortLinksByOwner :many
select short_link.id,
    short_link.owner_id,
    short_link.domain_id,
    short_link.slug,
    short_link.target_url,
    short_link.status,
    short_link.created_at,
    short_link.updated_at,
    short_link.deleted_at,
    domain.host as domain_host
from short_link
join domain on domain.id = short_link.domain_id
where short_link.owner_id = $1 and short_link.deleted_at is null
    and (sqlc.arg('status')::text = '' or short_link.status = sqlc.arg('status')::text)
order by short_link.created_at desc
limit $2 offset $3;

-- name: CountShortLinksByOwner :one
select count(*)
from short_link
where owner_id = $1 and deleted_at is null
    and (sqlc.arg('status')::text = '' or status = sqlc.arg('status')::text);

-- name: UpdateOwnShortLink :one
update short_link
set target_url = coalesce(sqlc.narg('target_url'), target_url),
    status = coalesce(sqlc.narg('status'), status),
    updated_at = now()
where id = sqlc.arg('id')
    and owner_id = sqlc.arg('owner_id')
    and deleted_at is null
returning id, owner_id, domain_id, slug, target_url, status, created_at, updated_at, deleted_at;

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
    short_link.created_at,
    short_link.updated_at,
    short_link.deleted_at,
    domain.host as domain_host,
    app_user.username as owner_username,
    app_user.nickname as owner_nickname
from short_link
join domain on domain.id = short_link.domain_id
join app_user on app_user.id = short_link.owner_id
where short_link.deleted_at is null
    and (sqlc.arg('status')::text = '' or short_link.status = sqlc.arg('status')::text)
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
join app_user on app_user.id = short_link.owner_id
where short_link.deleted_at is null
    and (sqlc.arg('status')::text = '' or short_link.status = sqlc.arg('status')::text)
    and (
        sqlc.arg('query')::text = ''
        or short_link.slug ilike '%' || sqlc.arg('query')::text || '%'
        or short_link.target_url ilike '%' || sqlc.arg('query')::text || '%'
        or app_user.username ilike '%' || sqlc.arg('query')::text || '%'
        or app_user.nickname ilike '%' || sqlc.arg('query')::text || '%'
    );

-- name: UpdateAnyShortLink :one
update short_link
set target_url = coalesce(sqlc.narg('target_url'), target_url),
    status = coalesce(sqlc.narg('status'), status),
    updated_at = now()
where id = sqlc.arg('id')
    and deleted_at is null
returning id, owner_id, domain_id, slug, target_url, status, created_at, updated_at, deleted_at;

-- name: SoftDeleteAnyShortLink :execrows
update short_link
set deleted_at = now(),
    updated_at = now()
where id = $1
    and deleted_at is null;
