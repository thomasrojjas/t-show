-- Operational expansion: organizations, approvals, requirements, incidents and guest passes.
-- Backend uses the server-only service role; all tables remain protected by RLS.
create extension if not exists "pgcrypto";

create table if not exists public.tshow_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 160),
  kind text not null default 'municipal' check (kind in ('municipal','producer','other')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.tshow_organization_members (
  organization_id uuid not null references public.tshow_organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
alter table public.tshow_projects add column if not exists organization_id uuid references public.tshow_organizations(id) on delete set null;
create index if not exists tshow_projects_org_idx on public.tshow_projects(organization_id) where deleted_at is null;

create table if not exists public.tshow_project_approvals (
  project_id uuid primary key references public.tshow_projects(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','review','approved','running','closed')),
  comment text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.tshow_project_approval_history (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  previous_status text, new_status text not null,
  comment text, created_at timestamptz not null default now()
);
create table if not exists public.tshow_project_requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 180),
  type text not null default 'other', file_key text,
  status text not null default 'pending' check (status in ('pending','uploaded','approved','rejected')),
  assigned_to uuid references public.profiles(id) on delete set null,
  due_at timestamptz, comment text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists tshow_requirements_project_idx on public.tshow_project_requirements(project_id,status,due_at);

create table if not exists public.tshow_incidents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 180),
  description text not null default '',
  type text not null default 'other' check (type in ('security','medical','technical','electrical','supplier','weather','crowd','access','transport','other')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','attending','resolved','closed')),
  location text, block_id text, assigned_to uuid references public.profiles(id) on delete set null,
  evidence_key text, created_by uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null, resolved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.tshow_incident_actions (
  id uuid primary key default gen_random_uuid(), incident_id uuid not null references public.tshow_incidents(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null, body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists tshow_incidents_project_idx on public.tshow_incidents(project_id,status,priority,created_at desc);

create table if not exists public.tshow_guest_passes (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.tshow_projects(id) on delete cascade,
  token_hash text not null unique, label text, include_script boolean not null default false,
  expires_at timestamptz not null default now() + interval '7 days', revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null, last_accessed_at timestamptz, access_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists tshow_guest_passes_project_idx on public.tshow_guest_passes(project_id,expires_at) where revoked_at is null;
create index if not exists tshow_org_members_user_idx on public.tshow_organization_members(user_id);

do $$ begin
  execute 'create trigger tshow_org_updated before update on public.tshow_organizations for each row execute function public.tshow_set_updated_at()';
exception when duplicate_object then null; end $$;
do $$ begin
  execute 'create trigger tshow_approval_updated before update on public.tshow_project_approvals for each row execute function public.tshow_set_updated_at()';
exception when duplicate_object then null; end $$;
do $$ begin
  execute 'create trigger tshow_requirement_updated before update on public.tshow_project_requirements for each row execute function public.tshow_set_updated_at()';
exception when duplicate_object then null; end $$;
do $$ begin
  execute 'create trigger tshow_incident_updated before update on public.tshow_incidents for each row execute function public.tshow_set_updated_at()';
exception when duplicate_object then null; end $$;

alter table public.tshow_organizations enable row level security;
alter table public.tshow_organization_members enable row level security;
alter table public.tshow_project_approvals enable row level security;
alter table public.tshow_project_approval_history enable row level security;
alter table public.tshow_project_requirements enable row level security;
alter table public.tshow_incidents enable row level security;
alter table public.tshow_incident_actions enable row level security;
alter table public.tshow_guest_passes enable row level security;
-- No anon/authenticated policy is granted for guest passes: public access is mediated by the API.
revoke all on public.tshow_guest_passes from anon, authenticated;
revoke all on public.tshow_project_approval_history from anon, authenticated;

do $$ begin alter publication supabase_realtime add table public.tshow_incidents; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tshow_project_requirements; exception when duplicate_object then null; end $$;
