-- +goose Up
alter table domain
    add column sort_order integer not null default 0,
    add constraint domain_sort_order_check check (sort_order between -10000 and 10000);

drop trigger domain_audit on domain;
create trigger domain_audit after insert or update or delete on domain
for each row execute function record_business_audit('domain','host,display_name,purpose,enabled,is_default,sort_order');

-- +goose Down
-- Restore the old trigger before dropping its newly referenced column.
-- Historical audit field names remain unchanged; only ordering values are lost.
drop trigger domain_audit on domain;
create trigger domain_audit after insert or update or delete on domain
for each row execute function record_business_audit('domain','host,display_name,purpose,enabled,is_default');

alter table domain drop constraint domain_sort_order_check, drop column sort_order;
