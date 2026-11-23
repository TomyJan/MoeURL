-- +goose Up
-- Fail with a useful error instead of silently renaming or merging an existing group.
-- +goose StatementBegin
do $$
begin
    if exists (
        select 1 from user_group
        group by lower(btrim(name))
        having count(*) > 1
    ) then
        raise exception 'existing user-group names are not unique after trimming and case folding';
    end if;
    if exists (
        select 1 from user_group
        where char_length(btrim(name)) < 1 or char_length(btrim(name)) > 64
           or char_length(description) > 500
    ) then
        raise exception 'existing user-group name or description exceeds the custom group limits';
    end if;
end
$$;
-- +goose StatementEnd

alter table user_group
    drop constraint user_group_default_domain_check,
    add constraint user_group_default_domain_check check (
        default_domain_id is null or (
            default_domain_id <> '00000000-0000-0000-0000-000000000000'::uuid
            and ((builtin and key in ('user', 'admin')) or not builtin)
        )
    ),
    add constraint user_group_name_length_check check (
        char_length(btrim(name)) between 1 and 64
        and char_length(description) <= 500
    );

create unique index user_group_normalized_name_uidx on user_group(lower(btrim(name)));

-- +goose Down
-- Never remove custom group data or convert its defaults into another group's data.
-- +goose StatementBegin
do $$
begin
    if exists (select 1 from user_group where not builtin) then
        raise exception 'custom user groups exist';
    end if;
end
$$;
-- +goose StatementEnd

drop index user_group_normalized_name_uidx;

alter table user_group
    drop constraint user_group_name_length_check,
    drop constraint user_group_default_domain_check,
    add constraint user_group_default_domain_check check (
        default_domain_id is null or (
            builtin and key in ('user', 'admin')
            and default_domain_id <> '00000000-0000-0000-0000-000000000000'::uuid
        )
    );
