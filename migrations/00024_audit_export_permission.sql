-- +goose Up
-- +goose StatementBegin
create table moeurl_audit_export_permission_addition (
    user_group_id uuid primary key references user_group(id) on delete cascade,
    permission_revision bigint not null default 0
);

insert into moeurl_audit_export_permission_addition (user_group_id)
select locked.id from (
    select id, permissions from user_group
    where builtin and key = 'admin' for update
) as locked where not (locked.permissions ? 'audit:export');

update user_group
set permissions = permissions || '["audit:export"]'::jsonb,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where builtin and key = 'admin' and not (permissions ? 'audit:export');

create function track_audit_export_permission_edits() returns trigger
language plpgsql as $$
begin
    if (old.permissions ? 'audit:export')
        is distinct from (new.permissions ? 'audit:export') then
        update moeurl_audit_export_permission_addition
        set permission_revision = permission_revision + 1 where user_group_id = new.id;
    end if;
    return new;
end;
$$;
create trigger track_updated_audit_export_permission
after update of permissions on user_group
for each row execute function track_audit_export_permission_edits();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop trigger track_updated_audit_export_permission on user_group;
drop function track_audit_export_permission_edits();
update user_group
set permissions = permissions - 'audit:export',
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where permissions ? 'audit:export' and exists (
    select 1 from moeurl_audit_export_permission_addition a
    where a.user_group_id=user_group.id and a.permission_revision=0
);
drop table moeurl_audit_export_permission_addition;
-- +goose StatementEnd
