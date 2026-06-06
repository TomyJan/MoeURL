-- +goose Up
-- +goose StatementBegin
create table system_setting (
    key text primary key,
    value jsonb not null,
    created_at timestamptz not null,
    updated_at timestamptz not null
);

create table user_group (
    id uuid primary key,
    key text not null unique,
    name text not null,
    description text not null default '',
    permissions jsonb not null,
    builtin boolean not null,
    created_at timestamptz not null,
    updated_at timestamptz not null
);

create table app_user (
    id uuid primary key,
    username text not null unique,
    password_hash text,
    nickname text not null,
    group_id uuid not null references user_group(id),
    status text not null,
    builtin boolean not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz
);

create index app_user_group_id_idx on app_user(group_id);
create index app_user_deleted_at_idx on app_user(deleted_at);

create table session (
    id uuid primary key,
    user_id uuid not null references app_user(id),
    expires_at timestamptz not null,
    last_seen_at timestamptz not null,
    revoked_at timestamptz,
    created_at timestamptz not null
);

create index session_user_id_idx on session(user_id);
create index session_expires_at_idx on session(expires_at);

create table domain (
    id uuid primary key,
    host text not null unique,
    display_name text not null,
    purpose text not null,
    enabled boolean not null,
    is_default boolean not null,
    created_at timestamptz not null,
    updated_at timestamptz not null
);

create unique index domain_single_enabled_default_idx
    on domain(is_default)
    where enabled = true and is_default = true;

create table short_link (
    id uuid primary key,
    owner_id uuid not null references app_user(id),
    domain_id uuid not null references domain(id),
    slug text not null unique,
    target_url text not null,
    status text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz
);

create index short_link_owner_id_idx on short_link(owner_id);
create index short_link_domain_id_idx on short_link(domain_id);
create index short_link_deleted_at_idx on short_link(deleted_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop table if exists short_link;
drop table if exists domain;
drop table if exists session;
drop table if exists app_user;
drop table if exists user_group;
drop table if exists system_setting;
-- +goose StatementEnd
