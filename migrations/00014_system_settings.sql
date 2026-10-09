-- +goose Up
-- +goose StatementBegin
insert into system_setting (key, value, created_at, updated_at)
values
    ('site.name', '"MoeURL"'::jsonb, now(), now()),
    ('site.default_language', '"zh-CN"'::jsonb, now(), now()),
    ('site.default_theme', '"system"'::jsonb, now(), now()),
    ('site.footer_text', '""'::jsonb, now(), now()),
    ('site.show_powered_by', 'true'::jsonb, now(), now()),
    ('auth.local_login_enabled', 'true'::jsonb, now(), now()),
    ('site.settings_revision', '1'::jsonb, now(), now())
on conflict (key) do nothing;

create table moeurl_system_settings_permission_addition (
    user_group_id uuid primary key references user_group(id) on delete cascade,
    permission_revision bigint not null default 0
);

insert into moeurl_system_settings_permission_addition (user_group_id)
select locked.id
from (
    select id, permissions
    from user_group
    where builtin and key = 'admin'
    for update
) as locked
where not (locked.permissions ? 'system:manage');

update user_group
set permissions = permissions || '["system:manage"]'::jsonb,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where builtin and key = 'admin' and not (permissions ? 'system:manage');

create function track_system_settings_permission_edits() returns trigger
language plpgsql as $$
begin
    if (old.permissions ? 'system:manage') is distinct from (new.permissions ? 'system:manage') then
        update moeurl_system_settings_permission_addition
        set permission_revision = permission_revision + 1
        where user_group_id = new.id;
    end if;
    return new;
end;
$$;

create trigger track_system_settings_permission_edits
after update of permissions on user_group
for each row execute function track_system_settings_permission_edits();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop trigger track_system_settings_permission_edits on user_group;
drop function track_system_settings_permission_edits();

update user_group
set permissions = permissions - 'system:manage',
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where exists (
    select 1
    from moeurl_system_settings_permission_addition as addition
    where addition.user_group_id = user_group.id
        and addition.permission_revision = 0
);

drop table moeurl_system_settings_permission_addition;
-- Settings are intentionally retained so rollback and re-upgrade do not lose administrator choices.
-- +goose StatementEnd
