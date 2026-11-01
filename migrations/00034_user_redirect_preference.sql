-- +goose Up
create table user_redirect_preference (
    user_id uuid primary key references app_user(id) on delete cascade,
    redirect_mode text check (redirect_mode in ('direct', 'intermediate', 'confirmation')),
    updated_at timestamptz not null default clock_timestamp()
);

-- +goose Down
drop table user_redirect_preference;
