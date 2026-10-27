-- +goose Up
alter table domain
    add column default_redirect_mode text not null default 'direct',
    add constraint domain_default_redirect_mode_check
        check (default_redirect_mode in ('direct', 'intermediate', 'confirmation'));

drop trigger domain_audit on domain;
create trigger domain_audit after insert or update or delete on domain
for each row execute function record_business_audit('domain','host,display_name,purpose,enabled,is_default,sort_order,default_redirect_mode');

-- +goose Down
-- Restore the legacy trigger before removing the field it no longer observes.
-- Only this configuration is discarded; historical audit field names remain.
drop trigger domain_audit on domain;
create trigger domain_audit after insert or update or delete on domain
for each row execute function record_business_audit('domain','host,display_name,purpose,enabled,is_default,sort_order');

alter table domain drop constraint domain_default_redirect_mode_check,
    drop column default_redirect_mode;
