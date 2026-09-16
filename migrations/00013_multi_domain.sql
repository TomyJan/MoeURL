-- +goose Up
-- +goose StatementBegin
create table domain_user_group (
    domain_id uuid not null references domain(id) on delete cascade,
    user_group_id uuid not null references user_group(id) on delete cascade,
    primary key (domain_id, user_group_id)
);

create index domain_user_group_group_id_idx on domain_user_group(user_group_id);

insert into domain_user_group (domain_id, user_group_id)
select domain.id, user_group.id
from domain
cross join user_group
where domain.is_default and domain.enabled and domain.purpose = 'short_link'
    and user_group.builtin and user_group.key in ('user', 'admin');

create table moeurl_multi_domain_permission_addition (
    user_group_id uuid not null references user_group(id) on delete cascade,
    permission text not null,
    revision bigint not null default 0,
    primary key (user_group_id, permission)
);

-- This lock is held through the permission update and the transaction commit.
insert into moeurl_multi_domain_permission_addition (user_group_id, permission)
select locked.id, addition.permission
from (select id, key, permissions from user_group
      where builtin and key in ('user', 'admin') for update) as locked
cross join lateral (values
    ('domain:use_assigned', locked.permissions ? 'domain:use_default'),
    ('domain:manage', locked.key = 'admin')
) as addition(permission, eligible)
where addition.eligible and not (locked.permissions ? addition.permission);

update user_group
set permissions = permissions
        || case when permissions ? 'domain:use_default' and not permissions ? 'domain:use_assigned'
            then '["domain:use_assigned"]'::jsonb else '[]'::jsonb end
        || case when key = 'admin' and not permissions ? 'domain:manage'
            then '["domain:manage"]'::jsonb else '[]'::jsonb end,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where builtin and key in ('user', 'admin')
    and ((permissions ? 'domain:use_default' and not permissions ? 'domain:use_assigned')
        or (key = 'admin' and not permissions ? 'domain:manage'));

create function track_multi_domain_permission_edits() returns trigger
language plpgsql as $$
begin
    if old.permissions is distinct from new.permissions then
        update moeurl_multi_domain_permission_addition
        set revision = revision + 1
        where user_group_id = new.id;
    end if;
    return new;
end;
$$;

create trigger track_multi_domain_permission_edits
after update of permissions on user_group
for each row execute function track_multi_domain_permission_edits();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop trigger track_multi_domain_permission_edits on user_group;
drop function track_multi_domain_permission_edits();

update user_group
set permissions = permissions - coalesce((
        select array_agg(addition.permission)
        from moeurl_multi_domain_permission_addition as addition
        where addition.user_group_id = user_group.id and addition.revision = 0
    ), array[]::text[]),
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
where exists (
    select 1 from moeurl_multi_domain_permission_addition as addition
    where addition.user_group_id = user_group.id and addition.revision = 0
);

drop table moeurl_multi_domain_permission_addition;
drop table domain_user_group;
-- +goose StatementEnd
