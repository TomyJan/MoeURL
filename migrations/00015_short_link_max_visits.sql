-- +goose Up
-- +goose StatementBegin
alter table short_link
    add column max_visits bigint,
    add column visits_used bigint not null default 0,
    add constraint short_link_visit_limit_check check (
        (
            max_visits is null
            and visits_used = 0
        )
        or (
            max_visits is not null
            and max_visits between 1 and 2147483647
            and visits_used between 0 and 2147483647
        )
    );

create table moeurl_short_link_max_visits_permission_addition (
    user_group_id uuid primary key references user_group(id) on delete cascade,
    permission_revision bigint not null default 0
);

insert into moeurl_short_link_max_visits_permission_addition (user_group_id)
select locked.id
from (
    select id, permissions
    from user_group
    where builtin and key in ('user', 'admin')
    for update
) as locked
where not (locked.permissions ? 'short_link:set_max_visits');

update user_group
set permissions = permissions || '["short_link:set_max_visits"]'::jsonb,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where builtin and key in ('user', 'admin')
    and not (permissions ? 'short_link:set_max_visits');

create function track_short_link_max_visits_permission_edits() returns trigger
language plpgsql as $$
begin
    if (old.permissions ? 'short_link:set_max_visits')
        is distinct from (new.permissions ? 'short_link:set_max_visits')
    then
        update moeurl_short_link_max_visits_permission_addition
        set permission_revision = permission_revision + 1
        where user_group_id = new.id;
    end if;
    return new;
end;
$$;

create trigger track_updated_short_link_max_visits_permission
after update of permissions on user_group
for each row execute function track_short_link_max_visits_permission_edits();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop trigger track_updated_short_link_max_visits_permission on user_group;
drop function track_short_link_max_visits_permission_edits();

update user_group
set permissions = permissions - 'short_link:set_max_visits',
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where permissions ? 'short_link:set_max_visits'
    and exists (
        select 1
        from moeurl_short_link_max_visits_permission_addition as addition
        where addition.user_group_id = user_group.id
            and addition.permission_revision = 0
    );

drop table moeurl_short_link_max_visits_permission_addition;

alter table short_link
    drop constraint short_link_visit_limit_check,
    drop column visits_used,
    drop column max_visits;
-- +goose StatementEnd
