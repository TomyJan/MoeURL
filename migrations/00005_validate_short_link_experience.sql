-- +goose Up
-- +goose StatementBegin
alter table short_link validate constraint short_link_redirect_mode_check;
alter table short_link validate constraint short_link_intermediate_delay_check;
-- +goose StatementEnd

-- Constraint validation is not meaningfully reversible. Migration 00004 removes
-- the constraints when the feature is fully rolled back.
-- +goose Down
select 1;
