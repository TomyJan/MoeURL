-- +goose Up
create table user_list_preference (
    user_id uuid primary key references app_user(id) on delete cascade,
    page_size smallint check (page_size in (20, 50, 100)),
    updated_at timestamptz not null default clock_timestamp()
);

-- +goose Down
drop table user_list_preference;
