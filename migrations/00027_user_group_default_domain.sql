-- +goose Up
alter table user_group
    add column default_domain_id uuid,
    add constraint user_group_default_domain_fk foreign key (default_domain_id) references domain(id),
    add constraint user_group_default_domain_check check (
        default_domain_id is null or (
            builtin and key in ('user', 'admin')
            and default_domain_id <> '00000000-0000-0000-0000-000000000000'::uuid
        )
    );

create index user_group_default_domain_idx on user_group(default_domain_id)
where default_domain_id is not null;

-- Keep the old permissions-only trigger and its permissions_change action intact.
-- +goose StatementBegin
create function record_user_group_default_domain_audit() returns trigger language plpgsql as $$
begin
    if current_setting('moeurl.audit_enabled', true) is distinct from 'on'
       or new.default_domain_id is not distinct from old.default_domain_id then
        return null;
    end if;
    insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields)
    values(nullif(current_setting('moeurl.audit_actor',true),'')::uuid,
           'user_group',new.id::text,'update',array['default_domain_id']);
    return null;
end $$;
-- +goose StatementEnd

create trigger user_group_default_domain_audit after update on user_group
for each row execute function record_user_group_default_domain_audit();

-- +goose Down
-- Saved defaults are discarded, but shared group revisions and audit history remain.
drop trigger user_group_default_domain_audit on user_group;
drop function record_user_group_default_domain_audit();
drop index user_group_default_domain_idx;
alter table user_group
    drop constraint user_group_default_domain_check,
    drop constraint user_group_default_domain_fk,
    drop column default_domain_id;
