-- name: ExportGlobalInsightVisits :many
with candidates as materialized (
    select id, short_link_id, created_at,
        coalesce(octet_length(referrer_host)::bigint,0)
        + coalesce(octet_length(device_type)::bigint,0)
        + coalesce(octet_length(browser_family)::bigint,0)
        + coalesce(octet_length(os_family)::bigint,0)
        + coalesce(octet_length(country_code)::bigint,0) as text_bytes
    from short_link_event
    where event_type='redirect_response_sent'
        and created_at>=sqlc.arg(range_start)::timestamptz
        and created_at<sqlc.arg(range_end)::timestamptz
    order by created_at desc,id desc limit 1001
), budget as materialized (
    select count(*)>1000 or coalesce(sum(text_bytes),0)>8388608 as limit_exceeded from candidates
), records as materialized (
    select c.id,c.short_link_id,c.created_at,e.referrer_host,e.device_type,e.browser_family,e.os_family,e.country_code
    from budget b cross join candidates c join short_link_event e on e.id=c.id
    where not b.limit_exceeded
)
select b.limit_exceeded::boolean as limit_exceeded,coalesce(r.id::text,'')::text as id,
    coalesce(r.short_link_id::text,'')::text as short_link_id,r.created_at,
    coalesce(r.referrer_host,'')::text as referrer_host,coalesce(r.device_type,'')::text as device_type,
    coalesce(r.browser_family,'')::text as browser_family,coalesce(r.os_family,'')::text as os_family,
    coalesce(r.country_code,'')::text as country_code
from budget b left join records r on true order by r.created_at desc,r.id desc;
