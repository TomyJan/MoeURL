-- +goose Up
-- +goose StatementBegin
alter table short_link
    add column password_hash text,
    add column password_failed_attempts smallint not null default 0,
    add column password_window_started_at timestamptz,
    add column password_blocked_until timestamptz,
    add column password_updated_at timestamptz;

alter table short_link
    add constraint short_link_password_failed_attempts_check
        check (password_failed_attempts >= 0) not valid;

create table short_link_access_grant (
    id uuid primary key,
    short_link_id uuid not null references short_link(id) on delete cascade,
    token_hash text not null unique,
    expires_at timestamptz not null,
    created_at timestamptz not null
);

create index short_link_access_grant_expiry_idx
    on short_link_access_grant(expires_at);

create index short_link_access_grant_link_idx
    on short_link_access_grant(short_link_id);

create table moeurl_short_link_password_permission_addition (
    user_group_id uuid not null references user_group(id) on delete cascade,
    permission text not null,
    primary key (user_group_id, permission)
);

comment on table moeurl_short_link_password_permission_addition is
    'Tracks permissions added by migration 00006 for reversible rollback.';

with locked_user_group as materialized (
    select id, permissions
    from user_group
    where key in ('user', 'admin')
    for update
)
insert into moeurl_short_link_password_permission_addition (user_group_id, permission)
select locked_user_group.id, 'short_link:set_password'
from locked_user_group
where not (locked_user_group.permissions ? 'short_link:set_password');

update user_group
set permissions = permissions || '["short_link:set_password"]'::jsonb,
    updated_at = now()
where key in ('user', 'admin')
    and not (permissions ? 'short_link:set_password');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
update user_group
set permissions = permissions - coalesce((
        select array_agg(addition.permission)
        from moeurl_short_link_password_permission_addition as addition
        where addition.user_group_id = user_group.id
    ), ARRAY[]::text[]),
    updated_at = now()
where exists (
    select 1
    from moeurl_short_link_password_permission_addition as addition
    where addition.user_group_id = user_group.id
);

drop table if exists moeurl_short_link_password_permission_addition;
drop table if exists short_link_access_grant;

alter table short_link
    drop constraint if exists short_link_password_failed_attempts_check,
    drop column if exists password_updated_at,
    drop column if exists password_blocked_until,
    drop column if exists password_window_started_at,
    drop column if exists password_failed_attempts,
    drop column if exists password_hash;
-- +goose StatementEnd
