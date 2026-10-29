-- +goose Up
insert into system_setting(key,value,created_at,updated_at)
values('site.home_content','{"title":"","summary":""}',now(),now())
on conflict(key) do nothing;

-- +goose StatementBegin
-- The legacy system-setting audit whitelist deliberately ignores this key.
-- Observe it separately without copying or widening the generic audit function.
create function record_home_content_audit() returns trigger language plpgsql as $$
begin
    if current_setting('moeurl.audit_enabled',true) is distinct from 'on' then
        return null;
    end if;
    if tg_op = 'UPDATE' and new.value is not distinct from old.value then
        return null;
    end if;
    insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields)
    values(nullif(current_setting('moeurl.audit_actor',true),'')::uuid,
        'system_setting','site.home_content','settings_change',array['site.home_content']);
    return null;
end $$;

create trigger home_content_audit after insert or update on system_setting
for each row when (new.key = 'site.home_content')
execute function record_home_content_audit();
-- +goose StatementEnd

-- +goose Down
-- Keep administrator content, its revision, and all historical audit records.
-- Older applications ignore the independent key; re-upgrade preserves its value.
drop trigger home_content_audit on system_setting;
drop function record_home_content_audit();
