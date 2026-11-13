-- +goose Up
insert into system_setting(key,value,created_at,updated_at)
values('security.target_cidr_denylist','{"prefixes":[]}',now(),now())
on conflict(key) do nothing;

-- +goose StatementBegin
create function record_target_cidr_denylist_audit() returns trigger language plpgsql as $$
begin
    if current_setting('moeurl.audit_enabled',true) is distinct from 'on' then
        return null;
    end if;
    if tg_op='UPDATE' and new.value is not distinct from old.value then
        return null;
    end if;
    insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields)
    values(nullif(current_setting('moeurl.audit_actor',true),'')::uuid,
        'system_setting','security.target_cidr_denylist','settings_change',array['security.target_cidr_denylist']);
    return null;
end $$;
create trigger target_cidr_denylist_audit after insert or update on system_setting
for each row when (new.key='security.target_cidr_denylist')
execute function record_target_cidr_denylist_audit();
-- +goose StatementEnd

-- +goose Down
-- Retain policy, exact revision and audit history. Older applications ignore
-- this key: CIDR restrictions disappear, while legacy rules remain.
drop trigger target_cidr_denylist_audit on system_setting;
drop function record_target_cidr_denylist_audit();
