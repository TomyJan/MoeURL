-- +goose Up
-- +goose StatementBegin
create function short_link_metadata_tags_valid(values_to_check text[]) returns boolean
language plpgsql immutable strict as $$
declare
    tag text;
begin
    if cardinality(values_to_check) > 10 or coalesce(array_ndims(values_to_check), 1) <> 1 then
        return false;
    end if;
    foreach tag in array values_to_check loop
        -- Use the Unicode whitespace set recognized by Go strings.TrimSpace.
        if tag is null
            or btrim(tag, E' \t\n\r\013\014' || U&'\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') = ''
            or char_length(tag) > 32 then
            return false;
        end if;
    end loop;
    return true;
end;
$$;

alter table short_link
    add column title text not null default '',
    add column tags text[] not null default '{}',
    add constraint short_link_metadata_title_check check (char_length(title) <= 120),
    add constraint short_link_metadata_tags_check check (short_link_metadata_tags_valid(tags));

create index short_link_tags_idx on short_link using gin (tags) where deleted_at is null;

create table moeurl_short_link_metadata_permission_addition (
    user_group_id uuid primary key references user_group(id) on delete cascade,
    permission_revision bigint not null default 0
);

insert into moeurl_short_link_metadata_permission_addition (user_group_id)
select locked.id
from (
    select id, permissions from user_group
    where builtin and key in ('user', 'admin')
    for update
) as locked
where not (locked.permissions ? 'short_link:set_metadata');

update user_group
set permissions = permissions || '["short_link:set_metadata"]'::jsonb,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where builtin and key in ('user', 'admin')
    and not (permissions ? 'short_link:set_metadata');

create function track_short_link_metadata_permission_edits() returns trigger
language plpgsql as $$
begin
    if (old.permissions ? 'short_link:set_metadata')
        is distinct from (new.permissions ? 'short_link:set_metadata')
    then
        update moeurl_short_link_metadata_permission_addition
        set permission_revision = permission_revision + 1
        where user_group_id = new.id;
    end if;
    return new;
end;
$$;

create trigger track_updated_short_link_metadata_permission
after update of permissions on user_group
for each row execute function track_short_link_metadata_permission_edits();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop trigger track_updated_short_link_metadata_permission on user_group;
drop function track_short_link_metadata_permission_edits();

update user_group
set permissions = permissions - 'short_link:set_metadata',
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where permissions ? 'short_link:set_metadata'
    and exists (
        select 1 from moeurl_short_link_metadata_permission_addition as addition
        where addition.user_group_id = user_group.id
            and addition.permission_revision = 0
    );

drop table moeurl_short_link_metadata_permission_addition;
drop index short_link_tags_idx;
alter table short_link
    drop constraint short_link_metadata_tags_check,
    drop constraint short_link_metadata_title_check,
    drop column tags,
    drop column title;
drop function short_link_metadata_tags_valid(text[]);
-- +goose StatementEnd
