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

-- v0.8.0 accepted any non-empty site name. Keep those installations bootable
-- under v0.9.0's 64-character contract without masking other corrupt values.
-- This character set matches Go's unicode.IsSpace White_Space table.
update system_setting
set value = to_jsonb(rtrim(
        left(btrim(value #>> '{}', U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000'), 64),
        U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000'
    )),
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where key = 'site.name'
    and jsonb_typeof(value) = 'string'
    and char_length(btrim(value #>> '{}', U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')) > 64;

-- Earlier versions did not constrain language and theme values. Normalize only
-- legacy strings so structurally corrupt JSON continues to fail startup checks.
update system_setting
set value = '"zh-CN"'::jsonb,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where key = 'site.default_language'
    and jsonb_typeof(value) = 'string'
    and btrim(value #>> '{}') <> ''
    and value #>> '{}' not in ('zh-CN', 'en');

update system_setting
set value = '"system"'::jsonb,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where key = 'site.default_theme'
    and jsonb_typeof(value) = 'string'
    and btrim(value #>> '{}') <> ''
    and value #>> '{}' not in ('system', 'light', 'dark');

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
    if tg_op = 'INSERT' then
        if new.builtin and new.key = 'admin' and new.permissions ? 'system:manage' then
            insert into moeurl_system_settings_permission_addition (user_group_id)
            values (new.id)
            on conflict (user_group_id) do nothing;
        end if;
        return new;
    end if;

    if (old.permissions ? 'system:manage') is distinct from (new.permissions ? 'system:manage') then
        update moeurl_system_settings_permission_addition
        set permission_revision = permission_revision + 1
        where user_group_id = new.id;
    end if;
    return new;
end;
$$;

create trigger track_inserted_system_settings_permission
after insert on user_group
for each row execute function track_system_settings_permission_edits();

create trigger track_updated_system_settings_permission
after update of permissions on user_group
for each row execute function track_system_settings_permission_edits();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop trigger track_inserted_system_settings_permission on user_group;
drop trigger track_updated_system_settings_permission on user_group;
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
