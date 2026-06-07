-- name: GetDefaultShortLinkDomain :one
select id, host, display_name, purpose, enabled, is_default, created_at, updated_at
from domain
where enabled = true and is_default = true
limit 1;

-- name: CreateDomain :one
insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
values ($1, $2, $3, $4, $5, $6, now(), now())
returning id, host, display_name, purpose, enabled, is_default, created_at, updated_at;
