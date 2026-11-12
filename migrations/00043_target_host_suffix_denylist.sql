-- +goose Up
insert into system_setting(key,value,created_at,updated_at)
values('security.target_host_suffix_denylist','{"suffixes":[]}',now(),now())
on conflict(key) do nothing;

-- +goose StatementBegin
create function record_target_host_suffix_denylist_audit() returns trigger language plpgsql as $$
begin
    if current_setting('moeurl.audit_enabled',true) is distinct from 'on' then
        return null;
    end if;
    if tg_op='UPDATE' and new.value is not distinct from old.value then
        return null;
    end if;
    insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields)
    values(nullif(current_setting('moeurl.audit_actor',true),'')::uuid,
        'system_setting','security.target_host_suffix_denylist','settings_change',array['security.target_host_suffix_denylist']);
    return null;
end $$;
create trigger target_host_suffix_denylist_audit after insert or update on system_setting
for each row when (new.key='security.target_host_suffix_denylist')
execute function record_target_host_suffix_denylist_audit();
-- +goose StatementEnd

-- +goose Down
-- Retain custom policy, exact revision and audit. Older applications ignore
-- this key and therefore cannot enforce the suffix denylist after rollback.
drop trigger target_host_suffix_denylist_audit on system_setting;
drop function record_target_host_suffix_denylist_audit();
