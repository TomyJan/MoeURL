-- +goose Up
create table app_user_group_membership (
    user_id uuid not null references app_user(id) on delete cascade,
    user_group_id uuid not null references user_group(id),
    primary key (user_id, user_group_id)
);

create index app_user_group_membership_group_user_idx
    on app_user_group_membership (user_group_id, user_id);

-- +goose Down
-- Memberships grant live access; never drop them implicitly during rollback.
-- +goose StatementBegin
do $$
begin
    if exists (select 1 from app_user_group_membership) then
        raise exception 'supplemental user group memberships exist';
    end if;
end
$$;
-- +goose StatementEnd

drop index app_user_group_membership_group_user_idx;
drop table app_user_group_membership;
