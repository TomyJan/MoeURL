-- +goose Up
-- +goose StatementBegin
-- Validate after 00009 has committed the constraint replacement, so the
-- ACCESS EXCLUSIVE lock from the replacement phase is already released.
alter table short_link validate constraint short_link_redirect_mode_check;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Restore the committed v9 state atomically before 00009 Down restores the
-- v8 constraint definition without changing redirect_mode data.
alter table short_link
    drop constraint short_link_redirect_mode_check,
    add constraint short_link_redirect_mode_check
        check (redirect_mode in ('direct', 'intermediate', 'confirmation')) not valid;
-- +goose StatementEnd
