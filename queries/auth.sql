-- name: EnsureAuthLoginAttempt :exec
insert into auth_login_attempt (
    username_hash,
    failed_attempts,
    window_started_at,
    blocked_until,
    updated_at
)
values ($1, 0, clock_timestamp(), null, clock_timestamp())
on conflict (username_hash) do nothing;

-- name: GetAuthLoginAttemptForUpdate :one
select
    username_hash,
    failed_attempts,
    window_started_at,
    blocked_until,
    updated_at,
    clock_timestamp()::timestamptz as database_time
from auth_login_attempt
where username_hash = $1
for update;

-- name: RecordAuthLoginFailure :one
with database_clock as (
    select clock_timestamp() as value
)
update auth_login_attempt as attempt
set failed_attempts = case
        when attempt.window_started_at <= database_clock.value - interval '15 minutes' then 1
        else attempt.failed_attempts + 1
    end,
    window_started_at = case
        when attempt.window_started_at <= database_clock.value - interval '15 minutes' then database_clock.value
        else attempt.window_started_at
    end,
    blocked_until = case
        when attempt.window_started_at <= database_clock.value - interval '15 minutes' then null
        when attempt.failed_attempts + 1 >= 10 then database_clock.value + interval '15 minutes'
        else attempt.blocked_until
    end,
    updated_at = database_clock.value
from database_clock
where attempt.username_hash = $1
returning attempt.*;

-- name: DeleteAuthLoginAttempt :execrows
delete from auth_login_attempt
where username_hash = $1;

-- name: DeleteStaleAuthLoginAttempts :execrows
with database_clock as (
    select clock_timestamp() as value
), stale_attempt as (
    select attempt.username_hash
    from auth_login_attempt as attempt
    cross join database_clock
    where attempt.updated_at <= database_clock.value - interval '15 minutes'
        and (attempt.blocked_until is null or attempt.blocked_until <= database_clock.value)
    order by attempt.updated_at, attempt.username_hash
    limit sqlc.arg(batch_size)::bigint
    for update of attempt skip locked
)
delete from auth_login_attempt as attempt
using stale_attempt
where attempt.username_hash = stale_attempt.username_hash;

-- name: GetAuthUserByUsername :one
select
    app_user.id::text as user_id,
    app_user.username,
    app_user.nickname,
    app_user.password_hash,
    app_user.status,
    user_group.key as group_key,
    user_group.permissions
from app_user
join user_group on user_group.id = app_user.group_id
where app_user.username = $1 and app_user.deleted_at is null;

-- name: CreateAuthSession :exec
insert into session (id, user_id, expires_at, last_seen_at, created_at)
values (
    sqlc.arg(session_id)::text,
    sqlc.arg(user_id)::text::uuid,
    sqlc.arg(expires_at)::timestamptz,
    clock_timestamp(),
    clock_timestamp()
);
