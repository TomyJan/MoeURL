-- +goose Up
-- +goose StatementBegin
create table moeurl_visit_export_permission_addition (
    user_group_id uuid primary key references user_group(id) on delete cascade,
    permission_revision bigint not null default 0
);

insert into moeurl_visit_export_permission_addition (user_group_id)
select locked.id from (
    select id, permissions from user_group
    where builtin and key in ('user', 'admin') for update
) as locked where not (locked.permissions ? 'short_link:export_visits');

update user_group
set permissions = permissions || '["short_link:export_visits"]'::jsonb,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where builtin and key in ('user', 'admin') and not (permissions ? 'short_link:export_visits');

create function track_visit_export_permission_edits() returns trigger
language plpgsql as $$
begin
    if (old.permissions ? 'short_link:export_visits')
        is distinct from (new.permissions ? 'short_link:export_visits') then
        update moeurl_visit_export_permission_addition
        set permission_revision = permission_revision + 1 where user_group_id = new.id;
    end if;
    return new;
end;
$$;
create trigger track_updated_visit_export_permission
after update of permissions on user_group
for each row execute function track_visit_export_permission_edits();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop trigger track_updated_visit_export_permission on user_group;
drop function track_visit_export_permission_edits();
update user_group
set permissions = permissions - 'short_link:export_visits',
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where permissions ? 'short_link:export_visits' and exists (
    select 1 from moeurl_visit_export_permission_addition a
    where a.user_group_id=user_group.id and a.permission_revision=0
);
drop table moeurl_visit_export_permission_addition;
-- +goose StatementEnd
