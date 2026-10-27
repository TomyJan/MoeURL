-- +goose Up
create table user_domain_preference (
    user_id uuid primary key references app_user(id) on delete cascade,
    domain_id uuid references domain(id),
    updated_at timestamptz not null default clock_timestamp()
);

create index user_domain_preference_domain_id_idx on user_domain_preference(domain_id);

-- +goose Down
drop table user_domain_preference;
