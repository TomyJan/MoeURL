-- +goose Up
-- +goose StatementBegin
alter table short_link_event
    add column browser_family text check (browser_family in ('chrome','edge','firefox','safari','opera','samsung','bot','other')),
    add column os_family text check (os_family in ('windows','macos','ios','android','linux','chromeos','other'));

create index short_link_event_success_time_id_idx on short_link_event(created_at desc, id desc)
    where event_type = 'redirect_response_sent';
create index short_link_event_success_link_time_id_idx on short_link_event(short_link_id, created_at desc, id desc)
    where event_type = 'redirect_response_sent';
create index short_link_live_created_idx on short_link(created_at) where deleted_at is null;

create table moeurl_insights_permission_addition (
    user_group_id uuid not null references user_group(id) on delete cascade,
    permission text not null,
    permission_revision bigint not null default 0,
    primary key (user_group_id, permission)
);

insert into moeurl_insights_permission_addition(user_group_id,permission)
select locked.id, desired.permission
from (select id,key,permissions from user_group where builtin and key in ('user','admin') for update) locked
cross join (values ('short_link:read_visits'),('statistics:read_all'),('audit:read')) desired(permission)
where (locked.key='admin' or desired.permission='short_link:read_visits')
    and not (locked.permissions ? desired.permission);

update user_group set permissions=user_group.permissions || added.permissions,
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
from (select user_group_id,jsonb_agg(permission order by permission) permissions
    from moeurl_insights_permission_addition group by user_group_id) added
where user_group.id=added.user_group_id;

create function track_insights_permission_edits() returns trigger language plpgsql as $$
begin
    update moeurl_insights_permission_addition as addition
    set permission_revision=permission_revision+1
    where addition.user_group_id=new.id
        and (old.permissions ? addition.permission) is distinct from (new.permissions ? addition.permission);
    return new;
end;
$$;
create trigger track_updated_insights_permission after update of permissions on user_group
    for each row execute function track_insights_permission_edits();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop trigger track_updated_insights_permission on user_group;
drop function track_insights_permission_edits();
update user_group set permissions=user_group.permissions - removed.permissions,
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
from (select user_group_id,array_agg(permission) permissions from moeurl_insights_permission_addition
    where permission_revision=0 group by user_group_id) removed
where user_group.id=removed.user_group_id and user_group.permissions ?| removed.permissions;
drop table moeurl_insights_permission_addition;
drop index short_link_live_created_idx;
drop index short_link_event_success_link_time_id_idx;
drop index short_link_event_success_time_id_idx;
alter table short_link_event drop column browser_family, drop column os_family;
-- +goose StatementEnd
