-- +goose Up
insert into system_setting(key,value,created_at,updated_at)
values('site.appearance','{"accentPreset":"iris"}',now(),now())
on conflict(key) do nothing;

-- +goose StatementBegin
-- Keep the existing system-setting whitelist and other resources independent.
create function record_appearance_audit() returns trigger language plpgsql as $$
begin
    if current_setting('moeurl.audit_enabled',true) is distinct from 'on' then
        return null;
    end if;
    if tg_op = 'UPDATE' and new.value is not distinct from old.value then
        return null;
    end if;
    insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields)
    values(nullif(current_setting('moeurl.audit_actor',true),'')::uuid,
        'system_setting','site.appearance','settings_change',array['site.appearance']);
    return null;
end $$;

create trigger appearance_audit after insert or update on system_setting
for each row when (new.key = 'site.appearance')
execute function record_appearance_audit();
-- +goose StatementEnd

-- +goose Down
-- Retain the chosen accent, complete revision, and historical audit metadata.
-- Old applications ignore the independent key; re-upgrade preserves its value.
drop trigger appearance_audit on system_setting;
drop function record_appearance_audit();
