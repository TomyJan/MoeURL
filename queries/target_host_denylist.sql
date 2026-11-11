-- name: GetTargetPolicyAdmin :one
select g.permissions from app_user u join user_group g on g.id=u.group_id
where u.id=$1 and u.status='active' and u.deleted_at is null and not u.builtin
    and g.builtin and g.key='admin';

-- name: LockTargetPolicyActor :one
select group_id from app_user
where id=$1 and status='active' and deleted_at is null and not builtin
for share;

-- name: LockTargetPolicyAdminGroup :one
select permissions from user_group where id=$1 and builtin and key='admin'
for share;

-- name: LockTargetWriterGroup :one
select key,permissions from user_group where id=$1 and builtin and key<>'guest'
for share;
