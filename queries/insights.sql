-- name: GetInsightActor :one
select app_user.id::text as id,user_group.key as group_key,user_group.permissions
from app_user join user_group on user_group.id=app_user.group_id
where app_user.id=sqlc.arg(user_id)::text::uuid and app_user.status='active'
    and app_user.deleted_at is null and user_group.key<>'guest';

-- name: GetInsightTime :one
select transaction_timestamp()::timestamptz as database_time;

-- name: GetDashboardSummary :one
select
    (select count(*) from app_user join user_group on user_group.id=app_user.group_id
        where app_user.deleted_at is null and user_group.key<>'guest')::bigint as user_count,
    (select count(*) from app_user join user_group on user_group.id=app_user.group_id
        where app_user.deleted_at is null and user_group.key<>'guest' and app_user.status='active')::bigint as active_user_count,
    (select count(*) from short_link where deleted_at is null)::bigint as link_count,
    (select count(*) from short_link where deleted_at is null and status='active')::bigint as active_link_count,
    (select count(*) from short_link where deleted_at is null and created_at>=sqlc.arg(today_start)::timestamptz
        and created_at<sqlc.arg(today_end)::timestamptz)::bigint as today_created_link_count,
    (select count(*) from short_link_event where event_type='redirect_response_sent'
        and created_at>=sqlc.arg(today_start)::timestamptz and created_at<sqlc.arg(today_end)::timestamptz)::bigint as today_visit_count,
    (select count(*) from short_link_event where event_type='redirect_response_sent'
        and created_at>=sqlc.arg(range_start)::timestamptz and created_at<sqlc.arg(range_end)::timestamptz)::bigint as range_visit_count;

-- name: ListDashboardTrend :many
with days as (
    select generate_series(sqlc.arg(range_start)::timestamptz at time zone 'UTC',
        (sqlc.arg(range_end)::timestamptz at time zone 'UTC')-interval '1 day',interval '1 day')::date as day
), visits as (
    select (created_at at time zone 'UTC')::date as day,count(*)::bigint as visit_count
    from short_link_event where event_type='redirect_response_sent'
        and created_at>=sqlc.arg(range_start)::timestamptz and created_at<sqlc.arg(range_end)::timestamptz
    group by 1
)
select days.day,coalesce(visits.visit_count,0)::bigint as visit_count
from days left join visits using(day) order by days.day;

-- name: ListDashboardTopLinks :many
with popular as (
    select short_link_id,count(*)::bigint as visit_count
    from short_link_event where event_type='redirect_response_sent'
        and created_at>=sqlc.arg(range_start)::timestamptz and created_at<sqlc.arg(range_end)::timestamptz
    group by short_link_id order by visit_count desc,short_link_id desc limit 10
)
select short_link.id::text as id,short_link.slug,domain.host,short_link.title,
    (short_link.deleted_at is not null)::boolean as deleted,popular.visit_count
from popular join short_link on short_link.id=popular.short_link_id
join domain on domain.id=short_link.domain_id
order by popular.visit_count desc,short_link.id desc;

-- name: GetInsightLink :one
select id::text as id from short_link
where id=sqlc.arg(id)::text::uuid and deleted_at is null
    and (sqlc.arg(admin)::boolean or owner_id=sqlc.arg(owner_id)::text::uuid);

-- name: ListInsightVisits :many
select id::text as id,created_at,referrer_host,device_type,browser_family,os_family,country_code
from short_link_event
where short_link_id=sqlc.arg(short_link_id)::text::uuid and event_type='redirect_response_sent'
    and created_at>=sqlc.arg(range_start)::timestamptz and created_at<sqlc.arg(range_end)::timestamptz
    and (sqlc.arg(device_type)::text='' or coalesce(nullif(device_type,''),'unknown')=sqlc.arg(device_type)::text)
    and (sqlc.arg(country_code)::text='' or coalesce(nullif(country_code,''),'unknown')=sqlc.arg(country_code)::text)
    and (not sqlc.arg(has_cursor)::boolean or (created_at,id)<(sqlc.arg(cursor_time)::timestamptz,sqlc.arg(cursor_id)::text::uuid))
order by created_at desc,id desc limit sqlc.arg(row_limit)::int;
