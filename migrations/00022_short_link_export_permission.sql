-- +goose Up
-- +goose StatementBegin
create table moeurl_short_link_export_permission_addition (
    user_group_id uuid primary key references user_group(id) on delete cascade,
    permission_revision bigint not null default 0
);

insert into moeurl_short_link_export_permission_addition (user_group_id)
select locked.id
from (
    select id, permissions from user_group
    where builtin and key in ('user', 'admin')
    for update
) as locked
where not (locked.permissions ? 'short_link:export');

update user_group
set permissions = permissions || '["short_link:export"]'::jsonb,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where builtin and key in ('user', 'admin') and not (permissions ? 'short_link:export');

create function track_short_link_export_permission_edits() returns trigger
language plpgsql as $$
begin
    if (old.permissions ? 'short_link:export')
        is distinct from (new.permissions ? 'short_link:export')
    then
        update moeurl_short_link_export_permission_addition
        set permission_revision = permission_revision + 1
        where user_group_id = new.id;
    end if;
    return new;
end;
$$;

create trigger track_updated_short_link_export_permission
after update of permissions on user_group
for each row execute function track_short_link_export_permission_edits();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop trigger track_updated_short_link_export_permission on user_group;
drop function track_short_link_export_permission_edits();

update user_group
set permissions = permissions - 'short_link:export',
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where permissions ? 'short_link:export'
    and exists (
        select 1 from moeurl_short_link_export_permission_addition as addition
        where addition.user_group_id = user_group.id and addition.permission_revision = 0
    );

drop table moeurl_short_link_export_permission_addition;
-- +goose StatementEnd
