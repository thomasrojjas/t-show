-- T-Show release foundation: schema tracking, transactional invitations,
-- feature entitlements, payment attempts, private uploads and safe guest snapshots.
-- Idempotent and safe to execute after migrations 001-020.

create extension if not exists "pgcrypto";
create schema if not exists private;
revoke all on schema private from public, anon;

create table if not exists public.tshow_schema_versions (
  version integer primary key,
  name text not null,
  checksum text,
  applied_at timestamptz not null default now()
);
revoke all on public.tshow_schema_versions from anon, authenticated;

insert into public.tshow_schema_versions(version, name)
values (21, 'release_foundation')
on conflict (version) do update set name = excluded.name;

-- Advanced modules stay disabled until a plan or an explicit account override
-- enables them.
create table if not exists public.tshow_plan_features (
  plan_id uuid not null references public.tshow_plans(id) on delete cascade,
  feature_key text not null check (feature_key in (
    'command_center','approvals','incidents','guest_passes','teleprompter',
    'erp','advanced_exports','integrations'
  )),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (plan_id, feature_key)
);

create table if not exists public.tshow_account_feature_overrides (
  account_id uuid not null references public.profiles(id) on delete cascade,
  feature_key text not null check (feature_key in (
    'command_center','approvals','incidents','guest_passes','teleprompter',
    'erp','advanced_exports','integrations'
  )),
  enabled boolean not null,
  reason text not null check (char_length(trim(reason)) between 2 and 500),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (account_id, feature_key)
);

alter table public.tshow_plan_features enable row level security;
alter table public.tshow_account_feature_overrides enable row level security;
revoke all on public.tshow_plan_features from anon, authenticated;
revoke all on public.tshow_account_feature_overrides from anon, authenticated;

-- A payment attempt is created before contacting a provider. The amount and
-- plan are immutable server decisions used later during reconciliation.
create table if not exists public.tshow_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.tshow_plans(id) on delete restrict,
  provider text not null check (provider in ('mercadopago_bricks','mercadopago_checkout_pro','mercadopago_subscription','flow')),
  interval text not null check (interval in ('month','year')),
  amount_clp integer not null check (amount_clp > 0),
  currency text not null default 'CLP' check (currency = 'CLP'),
  status text not null default 'created' check (status in (
    'created','processing','pending','approved','rejected','cancelled',
    'refunded','chargeback','failed','review'
  )),
  idempotency_key text not null unique,
  provider_object_id text,
  provider_status text,
  failure_code text,
  reconciled_at timestamptz,
  next_retry_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_object_id)
);
create index if not exists tshow_payment_attempts_reconcile_idx
  on public.tshow_payment_attempts(status, next_retry_at)
  where status in ('created','processing','pending','failed');
alter table public.tshow_payment_attempts enable row level security;
revoke all on public.tshow_payment_attempts from anon, authenticated;

alter table public.tshow_webhook_events
  add column if not exists status text not null default 'received',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text,
  add column if not exists next_retry_at timestamptz;
do $$ begin
  alter table public.tshow_webhook_events add constraint tshow_webhook_status_check
    check (status in ('received','processing','processed','failed','ignored'));
exception when duplicate_object then null; end $$;
create index if not exists tshow_webhook_events_pending_idx
  on public.tshow_webhook_events(status, next_retry_at)
  where status in ('received','failed');

alter table public.tshow_invitations
  add column if not exists resend_count integer not null default 0,
  add column if not exists resend_window_started_at timestamptz,
  add column if not exists last_sent_at timestamptz,
  add column if not exists delivery_error text;

-- Formal upload intent/finalization prevents database references to objects
-- that were never uploaded or do not match the approved content metadata.
create table if not exists public.tshow_upload_intents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.tshow_projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('avatar','cover','document','incident_evidence','block_attachment')),
  object_key text not null unique,
  original_filename text not null,
  content_type text not null,
  expected_size bigint not null check (expected_size > 0),
  status text not null default 'pending' check (status in ('pending','finalized','expired','failed')),
  expires_at timestamptz not null default now() + interval '5 minutes',
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tshow_upload_intents_cleanup_idx
  on public.tshow_upload_intents(status, expires_at);
alter table public.tshow_upload_intents enable row level security;
revoke all on public.tshow_upload_intents from anon, authenticated;

alter table public.tshow_project_assets
  add column if not exists category text not null default 'document',
  add column if not exists upload_intent_id uuid references public.tshow_upload_intents(id) on delete set null,
  add column if not exists replaced_by uuid references public.tshow_project_assets(id) on delete set null,
  add column if not exists deletion_pending boolean not null default false;
do $$ begin
  alter table public.tshow_project_assets add constraint tshow_project_assets_category_check
    check (category in ('cover','document','incident_evidence','block_attachment'));
exception when duplicate_object then null; end $$;

-- Guest passes publish a bounded immutable snapshot rather than reading the
-- mutable project payload on every public request.
alter table public.tshow_guest_passes
  add column if not exists published_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists published_version bigint,
  add column if not exists visibility jsonb not null default '{"date":true,"location":true,"schedule":true,"state":true,"notes":false,"script":false}'::jsonb,
  add column if not exists code_hash text,
  add column if not exists failed_unlock_attempts integer not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Complete requirement traceability without breaking existing rows.
alter table public.tshow_project_requirements
  add column if not exists file_id uuid references public.tshow_project_assets(id) on delete set null,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists version integer not null default 1;

create table if not exists public.tshow_incident_evidence (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.tshow_incidents(id) on delete cascade,
  file_id uuid not null references public.tshow_project_assets(id) on delete restrict,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(incident_id, file_id)
);
alter table public.tshow_incident_evidence enable row level security;
revoke all on public.tshow_incident_evidence from anon, authenticated;

-- Service-only, row-locked invitation acceptance. The caller identity and
-- email are provided by middleware after validating the Supabase JWT.
create or replace function public.tshow_accept_invitation_service(
  invitation_hash text,
  authenticated_user uuid,
  authenticated_email text
) returns table(project_id uuid, member_role public.tshow_member_role)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare invitation public.tshow_invitations%rowtype;
begin
  select * into invitation
  from public.tshow_invitations i
  where i.token_hash = invitation_hash
  for update;

  if invitation.id is null then raise exception 'INVITATION_NOT_FOUND'; end if;
  if invitation.status <> 'pending' then raise exception 'INVITATION_NOT_PENDING'; end if;
  if invitation.expires_at <= now() then
    update public.tshow_invitations set status = 'expired' where id = invitation.id;
    raise exception 'INVITATION_EXPIRED';
  end if;
  if lower(invitation.email) <> lower(authenticated_email) then raise exception 'INVITATION_EMAIL_MISMATCH'; end if;
  if not exists(select 1 from public.profiles p where p.id = authenticated_user) then raise exception 'PROFILE_NOT_FOUND'; end if;

  insert into public.tshow_project_members(project_id, user_id, role, invited_by)
  values(invitation.project_id, authenticated_user, invitation.role, invitation.invited_by)
  on conflict(project_id, user_id) do update set role = excluded.role;

  update public.tshow_invitations
  set status = 'accepted', accepted_by = authenticated_user, accepted_at = now()
  where id = invitation.id;

  insert into public.tshow_audit_log(project_id, actor_id, action, metadata)
  values(invitation.project_id, authenticated_user, 'invitation.accepted', jsonb_build_object('invitationId', invitation.id));

  return query select invitation.project_id, invitation.role;
end;
$$;
revoke all on function public.tshow_accept_invitation_service(text, uuid, text) from public, anon, authenticated;
grant execute on function public.tshow_accept_invitation_service(text, uuid, text) to service_role;

-- Organization roles used by command center. Replace the legacy check safely.
do $$ declare constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.tshow_organization_members'::regclass
    and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%'
  limit 1;
  if constraint_name is not null then
    execute format('alter table public.tshow_organization_members drop constraint %I', constraint_name);
  end if;
  alter table public.tshow_organization_members
    add constraint tshow_organization_members_role_check
    check (role in ('owner','admin','operator','viewer','member'));
exception when duplicate_object then null; end $$;

do $$ begin alter publication supabase_realtime add table public.tshow_incident_actions;
exception when duplicate_object then null; end $$;
