-- +goose Up
-- +goose StatementBegin
create table audit_log (
    id bigint generated always as identity primary key,
    actor_id uuid,
    resource_type text not null check (resource_type in ('short_link','user','user_group','domain','system_setting','oidc_provider')),
    resource_id text not null,
    action text not null check (action in ('create','update','enable','disable','delete','credential_change','permissions_change','assignment_change','settings_change')),
    changed_fields text[] not null,
    created_at timestamptz not null default clock_timestamp()
);
create index audit_log_created_at_id_idx on audit_log(created_at, id);

-- Only explicit application transactions opt in. The whitelist arguments contain
-- column names; comparison results are booleans and no business values are copied.
create function record_business_audit() returns trigger language plpgsql as $$
declare
    fields text[] := '{}';
    field_name text;
    changed boolean;
    resource text := tg_argv[0];
    resource_id text;
    action_name text := lower(tg_op);
begin
    if current_setting('moeurl.audit_enabled', true) is distinct from 'on' then return null; end if;
    if tg_table_name = 'system_setting' then
        if new.key not in ('site.name','site.system_domain','site.default_short_link_domain','site.default_language','site.default_theme','site.footer_text','site.show_powered_by','auth.local_login_enabled') then return null; end if;
        if tg_op = 'UPDATE' and new.value is not distinct from old.value then return null; end if;
        resource_id := new.key;
        fields := array[new.key];
        action_name := 'settings_change';
    elsif tg_table_name = 'domain_user_group' then
        if tg_op = 'DELETE' then resource_id := old.domain_id::text; else resource_id := new.domain_id::text; end if;
        fields := array['allowed_groups'];
        action_name := 'assignment_change';
    else
        if tg_op = 'DELETE' then resource_id := old.id::text; else resource_id := new.id::text; end if;
        foreach field_name in array string_to_array(tg_argv[1], ',') loop
            changed := true;
            if tg_op = 'UPDATE' then
                execute format('select ($1).%I is distinct from ($2).%I', field_name, field_name) into changed using new, old;
            end if;
            if changed then fields := array_append(fields, field_name); end if;
        end loop;
        if cardinality(fields) = 0 then return null; end if;
        if tg_op = 'INSERT' then action_name := 'create';
        elsif tg_op = 'UPDATE' then
            action_name := 'update';
            if 'deleted_at' = any(fields) then action_name := 'delete';
            elsif resource = 'user' and 'password_hash' = any(fields) then action_name := 'credential_change';
            elsif 'status' = any(fields) then
                if new.status = 'active' then action_name := 'enable'; else action_name := 'disable'; end if;
            elsif 'enabled' = any(fields) then
                if new.enabled then action_name := 'enable'; else action_name := 'disable'; end if;
            elsif resource = 'user_group' then action_name := 'permissions_change';
            end if;
        end if;
    end if;
    insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields)
    values(nullif(current_setting('moeurl.audit_actor',true),'')::uuid,resource,resource_id,action_name,fields);
    return null;
end $$;

create trigger short_link_audit after insert or update or delete on short_link for each row execute function record_business_audit('short_link','slug,owner_id,domain_id,target_url,status,redirect_mode,intermediate_delay_seconds,expires_at,password_hash,max_visits,title,tags,deleted_at');
create trigger app_user_audit after insert or update or delete on app_user for each row execute function record_business_audit('user','username,nickname,group_id,status,password_hash,deleted_at');
create trigger user_group_audit after update on user_group for each row execute function record_business_audit('user_group','permissions');
create trigger domain_audit after insert or update or delete on domain for each row execute function record_business_audit('domain','host,display_name,purpose,enabled,is_default');
create trigger domain_grant_audit after insert or delete on domain_user_group for each row execute function record_business_audit('domain');
create trigger system_setting_audit after insert or update on system_setting for each row execute function record_business_audit('system_setting');
create trigger oidc_provider_audit after insert or update or delete on oidc_provider for each row execute function record_business_audit('oidc_provider','key,display_name,issuer_url,client_id,client_secret_ciphertext,authorization_endpoint,token_endpoint,jwks_uri,allowed_email_domains,enabled,deleted_at');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Lock writers before inspecting history so a concurrent transaction cannot slip
-- an audit insert between the guard and trigger removal.
lock table short_link, app_user, user_group, domain, domain_user_group, system_setting, oidc_provider, audit_log in access exclusive mode;
do $$ begin
    if exists(select 1 from audit_log) then
        raise exception 'cannot rollback audit migration while audit history exists';
    end if;
end $$;
drop trigger short_link_audit on short_link;
drop trigger app_user_audit on app_user;
drop trigger user_group_audit on user_group;
drop trigger domain_audit on domain;
drop trigger domain_grant_audit on domain_user_group;
drop trigger system_setting_audit on system_setting;
drop trigger oidc_provider_audit on oidc_provider;
drop function record_business_audit();
drop table audit_log;
-- +goose StatementEnd
