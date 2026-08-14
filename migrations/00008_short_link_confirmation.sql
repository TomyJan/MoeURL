-- +goose Up
-- +goose StatementBegin
alter table short_link
    drop constraint if exists short_link_redirect_mode_check,
    add constraint short_link_redirect_mode_check
        check (redirect_mode in ('direct', 'intermediate', 'confirmation')) not valid;

create table short_link_confirmation_permission_addition (
    user_group_id uuid not null references user_group(id) on delete cascade,
    permission text not null,
    primary key (user_group_id, permission)
);

comment on table short_link_confirmation_permission_addition is
    'Tracks permissions added by migration 00008 for reversible rollback.';

with locked_user_group as materialized (
    select id, permissions
    from user_group
    where key in ('user', 'admin')
    for update
)
insert into short_link_confirmation_permission_addition (user_group_id, permission)
select locked_user_group.id, 'short_link:use_confirmation'
from locked_user_group
where not (locked_user_group.permissions ? 'short_link:use_confirmation');

update user_group
set permissions = permissions || '["short_link:use_confirmation"]'::jsonb,
    updated_at = now()
where key in ('user', 'admin')
    and not (permissions ? 'short_link:use_confirmation');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
update short_link
set redirect_mode = 'direct',
    updated_at = now()
where redirect_mode = 'confirmation';

alter table short_link
    drop constraint if exists short_link_redirect_mode_check,
    add constraint short_link_redirect_mode_check
        check (redirect_mode in ('direct', 'intermediate')) not valid;

alter table short_link validate constraint short_link_redirect_mode_check;

update user_group
set permissions = permissions - coalesce((
        select array_agg(addition.permission)
        from short_link_confirmation_permission_addition as addition
        where addition.user_group_id = user_group.id
    ), ARRAY[]::text[]),
    updated_at = now()
where exists (
    select 1
    from short_link_confirmation_permission_addition as addition
    where addition.user_group_id = user_group.id
);

drop table if exists short_link_confirmation_permission_addition;
-- +goose StatementEnd
