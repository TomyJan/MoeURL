-- +goose Up
insert into system_setting(key,value,created_at,updated_at)
values('security.account_daily_create_quota','{"dailyLimit":null}',now(),now())
on conflict(key) do nothing;

create table account_daily_create_usage (
    actor_id uuid primary key references app_user(id) on delete cascade,
    usage_day date not null check (usage_day between date '0001-01-01' and date '9999-12-31'),
    used bigint not null check (used>=0)
);

-- +goose StatementBegin
create function record_account_daily_create_quota_audit() returns trigger language plpgsql as $$
begin
    if current_setting('moeurl.audit_enabled',true) is distinct from 'on' then
        return null;
    end if;
    if tg_op='UPDATE' and new.value is not distinct from old.value then
        return null;
    end if;
    insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields)
    values(nullif(current_setting('moeurl.audit_actor',true),'')::uuid,
        'system_setting','security.account_daily_create_quota','settings_change',array['security.account_daily_create_quota']);
    return null;
end $$;
create trigger account_daily_create_quota_audit after insert or update on system_setting
for each row when (new.key='security.account_daily_create_quota')
execute function record_account_daily_create_quota_audit();
-- +goose StatementEnd

-- +goose Down
set local lock_timeout='5s';
-- +goose StatementBegin
do $$
declare today date;
begin
    perform pg_advisory_xact_lock(1297040725,1129403727);
    today := (pg_catalog.clock_timestamp() at time zone 'UTC')::date;
    if exists(select 1 from account_daily_create_usage where usage_day>=today and used>0) then
        raise exception 'cannot rollback daily create quota with current or future usage';
    end if;
end $$;
-- +goose StatementEnd
drop trigger account_daily_create_quota_audit on system_setting;
drop function record_account_daily_create_quota_audit();
drop table account_daily_create_usage;
-- Keep the policy revision and audit; older applications do not enforce quota.
