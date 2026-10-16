-- name: GetUserPreferences :one
select p.language, p.theme, p.updated_at
from app_user u
join user_group g on g.id = u.group_id
left join user_preference p on p.user_id = u.id
where u.id = sqlc.arg(user_id) and u.status = 'active'
  and u.deleted_at is null and g.key <> 'guest';

-- name: SaveUserPreferences :one
with eligible as materialized (
    select u.id from app_user u
    join user_group g on g.id = u.group_id
    where u.id = sqlc.arg(user_id) and u.status = 'active'
      and u.deleted_at is null and g.key <> 'guest'
    for share of u
)
insert into user_preference (user_id, language, theme)
select id, sqlc.narg(language)::text, sqlc.narg(theme)::text from eligible
where sqlc.narg(expected_updated_at)::timestamptz is null
   or exists (select 1 from user_preference p where p.user_id = eligible.id)
on conflict (user_id) do update
set language = excluded.language, theme = excluded.theme,
    updated_at = greatest(clock_timestamp(), user_preference.updated_at + interval '1 microsecond')
where sqlc.narg(expected_updated_at)::timestamptz is not null
  and user_preference.updated_at = sqlc.narg(expected_updated_at)::timestamptz
returning language, theme, updated_at;
