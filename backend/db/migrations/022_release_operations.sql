-- Release operations: secure guest sessions, document templates, immutable
-- financial transitions and cleanup support. Safe after migration 021.
create extension if not exists "pgcrypto";

insert into public.tshow_schema_versions(version, name)
values (22, 'release_operations')
on conflict (version) do update set name = excluded.name;

create table if not exists public.tshow_guest_sessions (
  id uuid primary key default gen_random_uuid(),
  pass_id uuid not null references public.tshow_guest_passes(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now()
);
create index if not exists tshow_guest_sessions_expiry_idx on public.tshow_guest_sessions(expires_at);
alter table public.tshow_guest_sessions enable row level security;
revoke all on public.tshow_guest_sessions from anon, authenticated;

create table if not exists public.tshow_requirement_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.tshow_organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 160),
  project_type text not null default 'other',
  requirements jsonb not null default '[]'::jsonb check (jsonb_typeof(requirements) = 'array'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tshow_requirement_templates_org_idx on public.tshow_requirement_templates(organization_id, project_type);
alter table public.tshow_requirement_templates enable row level security;
revoke all on public.tshow_requirement_templates from anon, authenticated;

create table if not exists public.tshow_payment_transitions (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.tshow_payment_attempts(id) on delete cascade,
  previous_status text,
  new_status text not null,
  source text not null check (source in ('checkout','webhook','reconciliation','admin')),
  provider_event_id text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists tshow_payment_transitions_attempt_idx on public.tshow_payment_transitions(attempt_id, created_at desc);
alter table public.tshow_payment_transitions enable row level security;
revoke all on public.tshow_payment_transitions from anon, authenticated;

create table if not exists public.tshow_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('upload_expiry','orphan_object','missing_object','payment_reconcile')),
  resource_id text,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  attempts integer not null default 0,
  last_error text,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tshow_cleanup_jobs_pending_idx on public.tshow_cleanup_jobs(status, run_after);
alter table public.tshow_cleanup_jobs enable row level security;
revoke all on public.tshow_cleanup_jobs from anon, authenticated;

create or replace function public.tshow_restore_project_service(target_project uuid, actor uuid)
returns public.tshow_projects
language plpgsql security definer set search_path = public, pg_temp
as $$
declare row public.tshow_projects%rowtype; allowed_limit integer; active_count integer;
begin
  select * into row from public.tshow_projects where id = target_project for update;
  if row.id is null or row.deleted_at is null then raise exception 'PROJECT_NOT_RESTORABLE'; end if;
  if actor <> row.owner_id and not exists(select 1 from public.profiles where id = actor and role = 'platform_admin') then raise exception 'PROJECT_RESTORE_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('tshow-project-quota:' || row.owner_id::text, 0));
  allowed_limit := public.tshow_effective_project_limit(row.owner_id);
  select count(*) into active_count from public.tshow_projects where owner_id = row.owner_id and deleted_at is null;
  if allowed_limit is not null and active_count >= allowed_limit then raise exception 'PROJECT_QUOTA_EXCEEDED'; end if;
  update public.tshow_projects set deleted_at = null, updated_at = now() where id = target_project returning * into row;
  return row;
end $$;
revoke all on function public.tshow_restore_project_service(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tshow_restore_project_service(uuid, uuid) to service_role;

