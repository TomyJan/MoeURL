-- +goose Up
-- +goose StatementBegin
create table short_link_note_append_batch (
    actor_id uuid not null references app_user(id),
    request_id uuid not null check (request_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    request_hash bytea not null check (octet_length(request_hash) = 32),
    appended_count smallint not null check (appended_count between 1 and 100),
    created_at timestamptz not null default now(),
    primary key (actor_id, request_id)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
lock table short_link_note_append_batch in access exclusive mode;
do $$
begin
    if exists (select 1 from short_link_note_append_batch) then
        raise exception 'cannot remove used batch note append receipts';
    end if;
end;
$$;
drop table short_link_note_append_batch;
-- +goose StatementEnd
