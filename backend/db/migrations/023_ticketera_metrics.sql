-- Read-only Ticketera integration for project-level attendance and sales metrics.
-- Safe to execute after migrations 021 and 022.
create extension if not exists "pgcrypto";

insert into public.tshow_schema_versions(version, name)
values (23, 'ticketera_metrics')
on conflict (version) do update set name = excluded.name;

create table if not exists public.tshow_ticketera_connections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.tshow_projects(id) on delete cascade,
  external_event_id text not null check (char_length(trim(external_event_id)) between 1 and 120),
  external_event_name text not null default '' check (char_length(external_event_name) <= 255),
  status text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  last_synced_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tshow_ticketera_connections_external_event_idx
  on public.tshow_ticketera_connections(external_event_id);
create index if not exists tshow_ticketera_connections_status_idx
  on public.tshow_ticketera_connections(status, updated_at desc);

alter table public.tshow_ticketera_connections enable row level security;
revoke all on public.tshow_ticketera_connections from anon, authenticated;

