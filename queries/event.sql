-- name: CreateShortLinkEvent :exec
insert into short_link_event (id, short_link_id, event_type, referrer_host, device_type, country_code, created_at)
values ($1, $2, $3, $4, $5, $6, now());

-- name: GetShortLinkAnalyticsSummary :one
select count(*)::bigint as visit_count,
    count(*) filter (where created_at >= current_date)::bigint as today_visit_count,
    max(created_at)::timestamptz as last_visited_at
from short_link_event
where short_link_id = $1 and event_type = 'redirect_response_sent';

-- name: ListShortLinkDailyVisits :many
with days as (
    select generate_series(current_date - interval '6 days', current_date, interval '1 day')::date as day
)
select days.day,
    count(short_link_event.id)::bigint as visit_count
from days
left join short_link_event
    on short_link_event.short_link_id = $1
    and short_link_event.event_type = 'redirect_response_sent'
    and short_link_event.created_at >= days.day
    and short_link_event.created_at < days.day + interval '1 day'
group by days.day
order by days.day;

-- name: ListShortLinkReferrerStats :many
with grouped as (
    select coalesce(nullif(referrer_host, ''), 'unknown') as value, count(*)::bigint as visit_count
    from short_link_event
    where short_link_id = $1 and event_type = 'redirect_response_sent'
    group by 1
), ranked as (
    select value, visit_count, row_number() over (order by visit_count desc, value asc) as rank
    from grouped
)
select case when rank <= 10 then value else 'other' end as value, sum(visit_count)::bigint as visit_count
from ranked
group by 1
order by visit_count desc, value asc;

-- name: ListShortLinkDeviceStats :many
with grouped as (
    select coalesce(nullif(device_type, ''), 'unknown') as value, count(*)::bigint as visit_count
    from short_link_event
    where short_link_id = $1 and event_type = 'redirect_response_sent'
    group by 1
), ranked as (
    select value, visit_count, row_number() over (order by visit_count desc, value asc) as rank
    from grouped
)
select case when rank <= 10 then value else 'other' end as value, sum(visit_count)::bigint as visit_count
from ranked
group by 1
order by visit_count desc, value asc;

-- name: ListShortLinkCountryStats :many
with grouped as (
    select coalesce(nullif(country_code, ''), 'unknown') as value, count(*)::bigint as visit_count
    from short_link_event
    where short_link_id = $1 and event_type = 'redirect_response_sent'
    group by 1
), ranked as (
    select value, visit_count, row_number() over (order by visit_count desc, value asc) as rank
    from grouped
)
select case when rank <= 10 then value else 'other' end as value, sum(visit_count)::bigint as visit_count
from ranked
group by 1
order by visit_count desc, value asc;
