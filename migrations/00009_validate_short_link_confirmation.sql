-- +goose Up
-- +goose StatementBegin
-- Resuming Up from a staged rollback restores the v0.4.0 constraint before
-- validation. A normal v8 upgrade already has this definition and skips DDL.
do $$
begin
    if exists (
        select 1
        from pg_constraint
        where conname = 'short_link_redirect_mode_check'
            and conrelid = 'short_link'::regclass
            and pg_get_constraintdef(oid) not like '%confirmation%'
    ) then
        execute 'alter table short_link drop constraint short_link_redirect_mode_check';
        execute $constraint$
            alter table short_link
                add constraint short_link_redirect_mode_check
                    check (redirect_mode in ('direct', 'intermediate', 'confirmation')) not valid
        $constraint$;
    end if;
end;
$$;

alter table short_link validate constraint short_link_redirect_mode_check;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Rollback permanently converts confirmation links to direct mode. Export the
-- affected short-link IDs before Down when later restoration is required.
update short_link
set redirect_mode = 'direct',
    updated_at = now()
where redirect_mode = 'confirmation';

alter table short_link
    drop constraint if exists short_link_redirect_mode_check,
    add constraint short_link_redirect_mode_check
        check (redirect_mode in ('direct', 'intermediate')) not valid;
-- +goose StatementEnd
