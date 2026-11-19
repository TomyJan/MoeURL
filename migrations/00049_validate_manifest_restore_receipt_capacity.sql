-- +goose Up
alter table short_link_create_batch
    validate constraint short_link_create_batch_created_count_check;

-- +goose Down
-- Validation is metadata on the 00048 constraint; 00048 Down owns its removal.
select 1;
