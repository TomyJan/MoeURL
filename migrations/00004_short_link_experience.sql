-- +goose Up
-- +goose StatementBegin
alter table short_link
    add column redirect_mode text not null default 'direct',
    add column intermediate_delay_seconds smallint not null default 5,
    add column expires_at timestamptz;

alter table short_link
    add constraint short_link_redirect_mode_check
        check (redirect_mode in ('direct', 'intermediate')) not valid,
    add constraint short_link_intermediate_delay_check
        check (intermediate_delay_seconds between 3 and 10) not valid;

create table moeurl_short_link_experience_permission_addition (
    user_group_id uuid not null references user_group(id),
    permission text not null,
    primary key (user_group_id, permission)
);

insert into moeurl_short_link_experience_permission_addition (user_group_id, permission)
select user_group.id, added.permission
from user_group
cross join (values
    ('short_link:use_intermediate'),
    ('short_link:set_expiration')
) as added(permission)
where user_group.key in ('user', 'admin')
    and not (user_group.permissions ? added.permission);

update user_group
set permissions = permissions
        || case
            when permissions ? 'short_link:use_intermediate' then '[]'::jsonb
            else '["short_link:use_intermediate"]'::jsonb
        end
        || case
            when permissions ? 'short_link:set_expiration' then '[]'::jsonb
            else '["short_link:set_expiration"]'::jsonb
        end,
    updated_at = now()
where key in ('user', 'admin');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
update user_group
set permissions = permissions - coalesce((
        select array_agg(addition.permission)
        from moeurl_short_link_experience_permission_addition as addition
        where addition.user_group_id = user_group.id
    ), ARRAY[]::text[]),
    updated_at = now()
where exists (
    select 1
    from moeurl_short_link_experience_permission_addition as addition
    where addition.user_group_id = user_group.id
);

drop table if exists moeurl_short_link_experience_permission_addition;

alter table short_link
    drop constraint if exists short_link_intermediate_delay_check,
    drop constraint if exists short_link_redirect_mode_check,
    drop column if exists expires_at,
    drop column if exists intermediate_delay_seconds,
    drop column if exists redirect_mode;
-- +goose StatementEnd
