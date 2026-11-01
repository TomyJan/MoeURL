-- name: LockBulkCreateActor :one
select id, group_id, status, deleted_at from app_user where id=$1 for update;

-- name: GetBulkCreateReceipt :one
select request_hash, created_count from short_link_create_batch
where actor_id=$1 and request_id=$2;

-- name: InsertBulkCreateReceipt :exec
insert into short_link_create_batch(actor_id,request_id,request_hash,created_count)
values ($1,$2,$3,$4);

-- name: CreateBulkShortLink :one
insert into short_link (
    id,owner_id,domain_id,slug,target_url,status,redirect_mode,
    intermediate_delay_seconds,expires_at,password_hash,password_updated_at,
    max_visits,title,tags,created_at,updated_at
) values ($1,$2,$3,$4,$5,'active','direct',5,null,null,null,null,'','{}',now(),now())
on conflict (slug) do nothing
returning id;
