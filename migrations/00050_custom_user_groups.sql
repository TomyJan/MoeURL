-- +goose Up
-- Fail with a useful error instead of silently renaming or merging an existing group.
-- +goose StatementBegin
do $$
begin
    if exists (
        select 1 from user_group
        group by lower(btrim(name))
        having count(*) > 1
    ) then
        raise exception 'existing user-group names are not unique after trimming and case folding';
    end if;
    if exists (
        select 1 from user_group
        where char_length(btrim(name)) < 1 or char_length(btrim(name)) > 64
           or char_length(description) > 500
    ) then
        raise exception 'existing user-group name or description exceeds the custom group limits';
    end if;
end
$$;
-- +goose StatementEnd

alter table user_group
    drop constraint user_group_default_domain_check,
    add constraint user_group_default_domain_check check (
        default_domain_id is null or (
            default_domain_id <> '00000000-0000-0000-0000-000000000000'::uuid
            and ((builtin and key in ('user', 'admin')) or not builtin)
        )
    ),
    add constraint user_group_name_length_check check (
        char_length(btrim(name)) between 1 and 64
        and char_length(description) <= 500
    );

create unique index user_group_normalized_name_uidx on user_group(lower(btrim(name)));

-- Keep lifecycle auditing separate from the existing permissions and default-domain triggers.
-- Only field names are recorded; names, descriptions, permissions and domain IDs are not copied.
-- +goose StatementBegin
create function record_user_group_lifecycle_audit() returns trigger language plpgsql as $$
declare
    resource_id text;
    action_name text;
    fields text[];
begin
    if current_setting('moeurl.audit_enabled', true) is distinct from 'on' then
        return null;
    end if;
    if tg_op = 'INSERT' then
        resource_id := new.id::text;
        action_name := 'create';
        fields := array['name','description','permissions'];
    else
        resource_id := old.id::text;
        action_name := 'delete';
        fields := array['name','description','permissions','default_domain_id'];
    end if;
    insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields)
    values(nullif(current_setting('moeurl.audit_actor',true),'')::uuid,
           'user_group',resource_id,action_name,fields);
    return null;
end $$;

create function record_user_group_details_audit() returns trigger language plpgsql as $$
declare
    fields text[] := array[]::text[];
begin
    if current_setting('moeurl.audit_enabled', true) is distinct from 'on' then
        return null;
    end if;
    if new.name is distinct from old.name then fields := array_append(fields,'name'); end if;
    if new.description is distinct from old.description then fields := array_append(fields,'description'); end if;
    if cardinality(fields) = 0 then return null; end if;
    insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields)
    values(nullif(current_setting('moeurl.audit_actor',true),'')::uuid,
           'user_group',new.id::text,'update',fields);
    return null;
end $$;
-- +goose StatementEnd

create trigger user_group_lifecycle_audit after insert or delete on user_group
for each row execute function record_user_group_lifecycle_audit();

create trigger user_group_details_audit after update of name, description on user_group
for each row execute function record_user_group_details_audit();

-- +goose Down
-- Never remove custom group data or convert its defaults into another group's data.
-- +goose StatementBegin
do $$
begin
    if exists (select 1 from user_group where not builtin) then
        raise exception 'custom user groups exist';
    end if;
end
$$;
-- +goose StatementEnd

drop index user_group_normalized_name_uidx;
drop trigger user_group_details_audit on user_group;
drop trigger user_group_lifecycle_audit on user_group;
drop function record_user_group_details_audit();
drop function record_user_group_lifecycle_audit();

alter table user_group
    drop constraint user_group_name_length_check,
    drop constraint user_group_default_domain_check,
    add constraint user_group_default_domain_check check (
        default_domain_id is null or (
            builtin and key in ('user', 'admin')
            and default_domain_id <> '00000000-0000-0000-0000-000000000000'::uuid
        )
    );
