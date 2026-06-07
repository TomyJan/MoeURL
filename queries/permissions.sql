-- name: GetPermissionsByUsername :one
select user_group.permissions
from app_user
join user_group on user_group.id = app_user.group_id
where app_user.username = $1 and app_user.deleted_at is null;
