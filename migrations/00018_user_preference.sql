-- +goose Up
create table user_preference (
    user_id uuid primary key references app_user(id) on delete cascade,
    language text check (language in ('zh-CN', 'en')),
    theme text check (theme in ('system', 'light', 'dark')),
    updated_at timestamptz not null default clock_timestamp()
);

-- +goose Down
drop table user_preference;
