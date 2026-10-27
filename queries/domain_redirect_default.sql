-- name: GetDomainRedirectDefaultActor :one
select app_user.id, app_user.group_id, user_group.key, user_group.permissions
from app_user
join user_group on user_group.id = app_user.group_id
where app_user.id = $1 and app_user.status = 'active' and app_user.deleted_at is null
  and user_group.builtin and user_group.key in ('user', 'admin');

-- name: GetDomainRedirectDefault :one
select id, host, display_name, purpose, enabled, is_default, created_at, updated_at, sort_order, default_redirect_mode
from domain where id = $1 and purpose = 'short_link';

-- name: GetDomainRedirectDefaultForUpdate :one
select id, host, display_name, purpose, enabled, is_default, created_at, updated_at, sort_order, default_redirect_mode
from domain where id = $1 and purpose = 'short_link' for update;

-- name: SetDomainRedirectDefault :one
update domain
set default_redirect_mode = sqlc.arg(redirect_mode),
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where id = sqlc.arg(id) and purpose = 'short_link' and updated_at = sqlc.arg(expected_updated_at)
returning id, host, display_name, purpose, enabled, is_default, created_at, updated_at, sort_order, default_redirect_mode;

-- name: ListEffectiveDomainRedirectDefaults :many
select domain.id,
       case when domain.default_redirect_mode = 'intermediate' and not sqlc.arg(can_intermediate)::boolean then 'direct'
            when domain.default_redirect_mode = 'confirmation' and not sqlc.arg(can_confirmation)::boolean then 'direct'
            else domain.default_redirect_mode end::text as redirect_mode
from domain
join domain_user_group on domain_user_group.domain_id = domain.id
where domain_user_group.user_group_id = sqlc.arg(group_id)
  and domain.enabled and domain.purpose = 'short_link'
  and ((domain.is_default and sqlc.arg(can_default)::boolean)
       or (not domain.is_default and sqlc.arg(can_assigned)::boolean))
order by domain.is_default desc, domain.sort_order, domain.created_at, domain.id;
