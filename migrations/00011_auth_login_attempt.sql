-- +goose Up
-- +goose StatementBegin
create table auth_login_attempt (
    username_hash text primary key,
    failed_attempts smallint not null,
    window_started_at timestamptz not null,
    blocked_until timestamptz,
	updated_at timestamptz not null
);
create index auth_login_attempt_updated_at_idx on auth_login_attempt (updated_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop table if exists auth_login_attempt;
-- +goose StatementEnd
