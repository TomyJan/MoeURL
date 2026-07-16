-- +goose Up
-- +goose StatementBegin
create table short_link_event (
    id uuid primary key,
    short_link_id uuid not null references short_link(id),
    event_type text not null,
    created_at timestamptz not null
);

create index short_link_event_short_link_id_idx on short_link_event(short_link_id);
create index short_link_event_type_created_at_idx on short_link_event(event_type, created_at);
create index short_link_event_short_link_created_at_idx on short_link_event(short_link_id, created_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop table if exists short_link_event;
-- +goose StatementEnd
