-- T-Show SaaS core. Run after 001_init.sql and 002_grant_service_role.sql.
-- Supabase Auth owns credentials; this schema only stores product data.
create extension if not exists "pgcrypto";

do $$ begin
  create type tshow_platform_role as enum ('platform_admin', 'account_owner', 'collaborator');
exception when duplicate_object then null; end $$;
do $$ begin
  create type tshow_member_role as enum ('editor', 'viewer');
exception when duplicate_object then null; end $$;
do $$ begin
  create type tshow_invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
exception when duplicate_object then null; end $$;
do $$ begin
  create type tshow_subscription_status as enum ('inactive', 'pending', 'active', 'past_due', 'cancelled', 'read_only');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(trim(first_name)) between 2 and 80),
  last_name text not null check (char_length(trim(last_name)) between 2 and 80),
  rut text not null unique check (rut ~ '^[0-9]{7,8}-[0-9K]$'),
  email text not null unique,
  phone text not null check (phone ~ '^\+?[0-9]{8,15}$'),
  role tshow_platform_role not null default 'account_owner',
  avatar_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.tshow_create_profile_for_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, first_name, last_name, rut, email, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'first_name', 'Pendiente'), coalesce(new.raw_user_meta_data->>'last_name', 'Pendiente'), coalesce(new.raw_user_meta_data->>'rut', '0000000-0'), lower(new.email), coalesce(new.raw_user_meta_data->>'phone', '00000000'))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists tshow_auth_profile_created on auth.users;
create trigger tshow_auth_profile_created after insert on auth.users for each row execute function public.tshow_create_profile_for_auth_user();

create table if not exists public.tshow_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  event_name text not null check (char_length(trim(event_name)) between 1 and 180),
  payload jsonb not null default '{}'::jsonb,
  cover_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists tshow_projects_owner_idx on public.tshow_projects(owner_id) where deleted_at is null;

create table if not exists public.tshow_project_members (
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role tshow_member_role not null default 'viewer',
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(project_id, user_id)
);

create table if not exists public.tshow_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  email text not null,
  role tshow_member_role not null,
  token_hash text not null unique,
  status tshow_invitation_status not null default 'pending',
  expires_at timestamptz not null default now() + interval '7 days',
  invited_by uuid not null references public.profiles(id),
  accepted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create index if not exists tshow_invitations_email_idx on public.tshow_invitations(lower(email), status);

create table if not exists public.tshow_live_sessions (
  project_id uuid primary key references public.tshow_projects(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  last_updated timestamptz not null default now()
);

create table if not exists public.tshow_audit_log (
  id bigint generated always as identity primary key,
  project_id uuid references public.tshow_projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists tshow_audit_project_idx on public.tshow_audit_log(project_id, created_at desc);

create table if not exists public.tshow_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  interval text not null check (interval in ('month', 'year')),
  amount_clp integer check (amount_clp is null or amount_clp > 0),
  active boolean not null default false,
  benefits jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
insert into public.tshow_plans (code, name, interval, amount_clp, active)
values ('monthly', 'Plan mensual', 'month', null, false), ('annual', 'Plan anual', 'year', null, false)
on conflict (code) do nothing;

create table if not exists public.tshow_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.profiles(id) on delete cascade,
  plan_id uuid references public.tshow_plans(id),
  provider text,
  provider_subscription_id text,
  status tshow_subscription_status not null default 'inactive',
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_subscription_id)
);

create table if not exists public.tshow_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.tshow_subscriptions(id) on delete set null,
  account_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  provider_payment_id text not null,
  status text not null,
  amount_clp integer,
  raw_event jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, provider_payment_id)
);

create table if not exists public.tshow_webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_key text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider, event_key)
);

create or replace function public.tshow_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create or replace function public.tshow_is_project_member(target_project uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.tshow_projects p where p.id = target_project and p.owner_id = auth.uid() and p.deleted_at is null)
  or exists(select 1 from public.tshow_project_members m where m.project_id = target_project and m.user_id = auth.uid());
$$;
drop trigger if exists tshow_profiles_updated on public.profiles;
create trigger tshow_profiles_updated before update on public.profiles for each row execute function public.tshow_set_updated_at();
drop trigger if exists tshow_projects_updated on public.tshow_projects;
create trigger tshow_projects_updated before update on public.tshow_projects for each row execute function public.tshow_set_updated_at();
drop trigger if exists tshow_subscriptions_updated on public.tshow_subscriptions;
create trigger tshow_subscriptions_updated before update on public.tshow_subscriptions for each row execute function public.tshow_set_updated_at();

alter table public.profiles enable row level security;
alter table public.tshow_projects enable row level security;
alter table public.tshow_project_members enable row level security;
alter table public.tshow_live_sessions enable row level security;
alter table public.tshow_invitations enable row level security;
alter table public.tshow_subscriptions enable row level security;
alter table public.tshow_plans enable row level security;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists projects_member_read on public.tshow_projects;
create policy projects_member_read on public.tshow_projects for select to authenticated using (public.tshow_is_project_member(id));
drop policy if exists live_member_read on public.tshow_live_sessions;
create policy live_member_read on public.tshow_live_sessions for select to authenticated using (public.tshow_is_project_member(project_id));
drop policy if exists plans_public_read on public.tshow_plans;
create policy plans_public_read on public.tshow_plans for select to authenticated using (active = true);

-- Realtime delivery for live changes. It is safe because the select policy above applies.
do $$ begin alter publication supabase_realtime add table public.tshow_live_sessions; exception when duplicate_object then null; end $$;
