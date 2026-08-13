-- +goose Up
-- +goose StatementBegin
alter table short_link validate constraint short_link_redirect_mode_check;
-- +goose StatementEnd

-- Constraint validation is not meaningfully reversible. Migration 00008
-- restores the previous constraint when confirmation mode is rolled back.
-- +goose Down
select 1;
