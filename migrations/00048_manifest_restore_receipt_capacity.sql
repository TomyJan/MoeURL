-- +goose Up
alter table short_link_create_batch
    drop constraint short_link_create_batch_created_count_check,
    add constraint short_link_create_batch_created_count_check
        check (created_count between 1 and 100) not valid;

-- +goose Down
lock table short_link_create_batch in access exclusive mode;

-- +goose StatementBegin
do $$
begin
    if exists (select 1 from short_link_create_batch where created_count > 20) then
        raise exception 'cannot reduce receipt capacity while larger manifest restore receipts exist';
    end if;
end;
$$;
-- +goose StatementEnd

alter table short_link_create_batch
    drop constraint short_link_create_batch_created_count_check,
    add constraint short_link_create_batch_created_count_check
        check (created_count between 1 and 20);
