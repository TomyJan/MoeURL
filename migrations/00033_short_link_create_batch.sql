-- +goose Up
-- +goose StatementBegin
create table short_link_create_batch (
    actor_id uuid not null references app_user(id),
    request_id uuid not null check (request_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    request_hash bytea not null check (octet_length(request_hash) = 32),
    created_count smallint not null check (created_count between 1 and 20),
    created_at timestamptz not null default now(),
    primary key (actor_id, request_id)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
do $$
begin
    if exists (select 1 from short_link_create_batch) then
        raise exception 'cannot remove used batch creation receipts';
    end if;
end;
$$;
drop table short_link_create_batch;
-- +goose StatementEnd
