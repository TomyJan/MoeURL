-- +goose Up
-- +goose StatementBegin
alter table short_link
    add column note text not null default '' check (char_length(note) <= 1000),
    add column note_updated_at timestamptz not null default now();
drop trigger short_link_audit on short_link;
create trigger short_link_audit after insert or update or delete on short_link for each row
execute function record_business_audit('short_link','slug,owner_id,domain_id,target_url,status,redirect_mode,intermediate_delay_seconds,expires_at,password_hash,max_visits,title,tags,deleted_at,note');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
lock table short_link in access exclusive mode;
do $$
begin
    if exists (select 1 from short_link where note <> '') then
        raise exception 'cannot remove nonempty short link notes';
    end if;
end $$;
drop trigger short_link_audit on short_link;
create trigger short_link_audit after insert or update or delete on short_link for each row
execute function record_business_audit('short_link','slug,owner_id,domain_id,target_url,status,redirect_mode,intermediate_delay_seconds,expires_at,password_hash,max_visits,title,tags,deleted_at');
alter table short_link drop column note, drop column note_updated_at;
-- +goose StatementEnd
