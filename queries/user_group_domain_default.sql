-- name: LockGroupDefaultAdmin :one
select id, key, name, description, permissions, builtin, created_at, updated_at
from user_group
where id = $1 and builtin and key = 'admin'
for update;

-- name: LockGroupDefaultTarget :one
select id, key, name, description, permissions, builtin, created_at, updated_at
from user_group
where key = $1 and builtin and key in ('user', 'admin')
for update;
