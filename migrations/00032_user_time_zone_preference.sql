-- +goose Up
create table user_time_zone_preference (
    user_id uuid primary key references app_user(id) on delete cascade,
    time_zone text check (time_zone in (
        'UTC', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo',
        'Europe/London', 'Europe/Paris', 'America/New_York',
        'America/Los_Angeles', 'Australia/Sydney'
    )),
    updated_at timestamptz not null default clock_timestamp()
);

-- +goose Down
drop table user_time_zone_preference;
