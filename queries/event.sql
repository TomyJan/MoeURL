-- name: CreateShortLinkEvent :exec
insert into short_link_event (id, short_link_id, event_type, created_at)
values ($1, $2, $3, now());
