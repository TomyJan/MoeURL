-- +goose Up
-- +goose StatementBegin
alter table short_link_event
    add column referrer_host text,
    add column device_type text,
    add column country_code text;

create index short_link_event_analytics_idx
    on short_link_event (short_link_id, event_type, created_at desc);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop index if exists short_link_event_analytics_idx;

alter table short_link_event
    drop column if exists country_code,
    drop column if exists device_type,
    drop column if exists referrer_host;
-- +goose StatementEnd
