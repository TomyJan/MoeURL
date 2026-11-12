-- name: GetCreateQuotaAdmin :one
select g.permissions from app_user u join user_group g on g.id=u.group_id
where u.id=$1 and u.status='active' and u.deleted_at is null and not u.builtin
    and g.builtin and g.key='admin';

-- name: LockCreateQuotaActor :one
select group_id from app_user
where id=$1 and status='active' and deleted_at is null and not builtin
for share;

-- name: LockCreateQuotaAdminGroup :one
select permissions from user_group where id=$1 and builtin and key='admin'
for share;

-- name: EnsureAccountDailyCreateUsage :exec
insert into account_daily_create_usage(actor_id,usage_day,used)
values($1,date '0001-01-01',0) on conflict(actor_id) do nothing;

-- name: LockAccountDailyCreateUsage :one
select usage_day,used from account_daily_create_usage where actor_id=$1 for update;

-- name: GetAccountDailyCreateQuotaDay :one
select (pg_catalog.clock_timestamp() at time zone 'UTC')::date as quota_day;

-- name: SetAccountDailyCreateUsage :exec
update account_daily_create_usage set usage_day=$2,used=$3 where actor_id=$1;
