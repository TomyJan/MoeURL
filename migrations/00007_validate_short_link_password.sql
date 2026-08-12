-- +goose Up
-- +goose StatementBegin
alter table short_link validate constraint short_link_password_failed_attempts_check;
-- +goose StatementEnd

-- Constraint validation is not meaningfully reversible. Migration 00006 removes
-- the constraint when protected short-link access is fully rolled back.
-- +goose Down
select 1;
