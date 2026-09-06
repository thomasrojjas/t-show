-- T-Show multi-tenant production core.
-- Keeps tshow_projects.payload backwards-compatible while normalizing blocks
-- transactionally for the ERP, offline sync and integration layers.

create extension if not exists "pgcrypto";
create schema if not exists private;
revoke all on schema private from public, anon;

alter table public.tshow_organizations
  add column if not exists slug text,
  add column if not exists billing_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists status text not null default 'active',
  add column if not exists is_personal boolean not null default false,
  add column if not exists settings jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.tshow_organizations add constraint tshow_organizations_status_check
    check (status in ('active', 'suspended', 'archived'));
exception when duplicate_object then null; end $$;

update public.tshow_organizations
set slug = 'org-' || left(replace(id::text, '-', ''), 12)
where slug is null;

create unique index if not exists tshow_organizations_slug_uidx
  on public.tshow_organizations(lower(slug));

alter table public.profiles
  add column if not exists default_organization_id uuid references public.tshow_organizations(id) on delete set null;

-- Every existing account receives a personal workspace if it is not already
-- linked to an organization. The UUID-derived slug makes this idempotent.
insert into public.tshow_organizations (name, slug, kind, created_by, billing_owner_id, is_personal)
select
  trim(concat(p.first_name, ' ', p.last_name)),
  'personal-' || left(replace(p.id::text, '-', ''), 12),
  'producer',
  p.id,
  p.id,
  true
from public.profiles p
where not exists (
  select 1 from public.tshow_organization_members m where m.user_id = p.id
)
on conflict do nothing;

insert into public.tshow_organization_members (organization_id, user_id, role)
select o.id, o.billing_owner_id, 'owner'
from public.tshow_organizations o
where o.is_personal and o.billing_owner_id is not null
on conflict (organization_id, user_id) do nothing;

update public.profiles p
set default_organization_id = (
  select m.organization_id
  from public.tshow_organization_members m
  where m.user_id = p.id
  order by (m.role = 'owner') desc, m.created_at
  limit 1
)
where p.default_organization_id is null
  and exists (select 1 from public.tshow_organization_members m where m.user_id = p.id);

update public.tshow_projects p
set organization_id = owner_profile.default_organization_id
from public.profiles owner_profile
where p.owner_id = owner_profile.id
  and p.organization_id is null
  and owner_profile.default_organization_id is not null;

alter table public.tshow_projects
  add column if not exists document_version bigint not null default 1,
  add column if not exists operational_status text not null default 'draft';

do $$ begin
  alter table public.tshow_projects add constraint tshow_projects_operational_status_check
    check (operational_status in ('draft', 'review', 'approved', 'running', 'closed', 'archived'));
exception when duplicate_object then null; end $$;

create table if not exists public.tshow_departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.tshow_organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  color text not null default 'blue',
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.tshow_project_blocks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  external_id text not null,
  position integer not null check (position >= 0),
  block_type text not null default 'other',
  title text not null default '',
  start_time text,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  end_time text,
  department_id uuid references public.tshow_departments(id) on delete set null,
  status text not null default 'pending',
  notes text not null default '' check (char_length(notes) <= 4000),
  animator_script text not null default '' check (char_length(animator_script) <= 8000),
  metadata jsonb not null default '{}'::jsonb,
  notes_updated_at timestamptz,
  notes_updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, external_id),
  unique (project_id, position)
);

do $$ begin
  alter table public.tshow_project_blocks add constraint tshow_project_blocks_status_check
    check (status in ('pending', 'running', 'completed', 'delayed', 'skipped'));
exception when duplicate_object then null; end $$;

create index if not exists tshow_project_blocks_project_idx
  on public.tshow_project_blocks(project_id, position);
create index if not exists tshow_project_blocks_department_idx
  on public.tshow_project_blocks(department_id) where department_id is not null;

create table if not exists public.tshow_project_document_versions (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  version bigint not null,
  snapshot jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);
create index if not exists tshow_document_versions_project_idx
  on public.tshow_project_document_versions(project_id, version desc);

create table if not exists public.tshow_project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  block_id uuid references public.tshow_project_blocks(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  timecode_seconds integer check (timecode_seconds is null or timecode_seconds >= 0),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tshow_project_comments_project_idx
  on public.tshow_project_comments(project_id, created_at desc);

create table if not exists public.tshow_project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  block_id uuid references public.tshow_project_blocks(id) on delete set null,
  object_key text not null unique,
  filename text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  visibility text not null default 'private',
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
do $$ begin
  alter table public.tshow_project_assets add constraint tshow_project_assets_visibility_check
    check (visibility in ('private', 'guest'));
exception when duplicate_object then null; end $$;
create index if not exists tshow_project_assets_project_idx
  on public.tshow_project_assets(project_id, created_at desc) where deleted_at is null;

-- Authorization helper lives outside the exposed public schema. It uses only
-- trusted database data and the immutable auth user id, never user_metadata.
create or replace function private.tshow_can_access_project(target_project uuid, required_access text default 'read')
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tshow_projects p
    left join public.tshow_project_members pm
      on pm.project_id = p.id and pm.user_id = (select auth.uid())
    left join public.tshow_organization_members om
      on om.organization_id = p.organization_id and om.user_id = (select auth.uid())
    where p.id = target_project
      and p.deleted_at is null
      and (
        p.owner_id = (select auth.uid())
        or pm.user_id is not null
        or om.role in ('owner', 'admin')
        or exists (
          select 1 from public.profiles profile
          where profile.id = (select auth.uid()) and profile.role = 'platform_admin'
        )
      )
      and (
        required_access = 'read'
        or p.owner_id = (select auth.uid())
        or pm.role = 'editor'
        or om.role in ('owner', 'admin')
        or exists (
          select 1 from public.profiles profile
          where profile.id = (select auth.uid()) and profile.role = 'platform_admin'
        )
      )
  );
$$;
revoke all on function private.tshow_can_access_project(uuid, text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.tshow_can_access_project(uuid, text) to authenticated;

-- Snapshot the previous document and increment its optimistic concurrency
-- version inside the same transaction as every payload update.
create or replace function public.tshow_version_project_document()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.payload is distinct from old.payload then
    insert into public.tshow_project_document_versions
      (project_id, version, snapshot, created_by, reason)
    values
      (
        old.id,
        old.document_version,
        old.payload,
        case
          when coalesce(current_setting('request.jwt.claim.sub', true), '')
            ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          then current_setting('request.jwt.claim.sub', true)::uuid
          else null
        end,
        'automatic'
      );
    new.document_version := old.document_version + 1;
  end if;
  return new;
end;
$$;

-- The compatibility document remains writable by the current frontend. This
-- trigger materializes it into relational rows atomically on insert/update.
create or replace function public.tshow_materialize_project_blocks()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare item jsonb; ordinal bigint; external text;
begin
  delete from public.tshow_project_blocks where project_id = new.id;
  for item, ordinal in
    select value, ordinality from jsonb_array_elements(coalesce(new.payload->'blocks', '[]'::jsonb)) with ordinality
  loop
    external := coalesce(nullif(item->>'id', ''), nullif(item->>'itemNum', ''), 'legacy-' || ordinal::text);
    insert into public.tshow_project_blocks (
      project_id, external_id, position, block_type, title, start_time,
      duration_minutes, end_time, status, notes, animator_script, metadata,
      notes_updated_at, notes_updated_by
    ) values (
      new.id,
      external,
      (ordinal - 1)::integer,
      coalesce(nullif(item->>'type', ''), 'other'),
      coalesce(item->>'title', ''),
      coalesce(item->>'start', item->>'startTime'),
      case
        when coalesce(item->>'duration', '') ~ '^[0-9]+$' then greatest((item->>'duration')::integer, 0)
        else 0
      end,
      coalesce(item->>'end', item->>'endTime'),
      case when item->>'status' in ('pending','running','completed','delayed','skipped') then item->>'status' else 'pending' end,
      left(coalesce(item->>'notes', ''), 4000),
      left(coalesce(item->>'animator_script', ''), 8000),
      item - array['notes', 'animator_script'],
      case when coalesce(item->>'notes_updated_at', '') ~ '^\d{4}-\d{2}-\d{2}' then (item->>'notes_updated_at')::timestamptz else null end,
      case when coalesce(item->>'notes_updated_by', '') ~ '^[0-9a-fA-F-]{36}$' then (item->>'notes_updated_by')::uuid else null end
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists tshow_project_document_version on public.tshow_projects;
create trigger tshow_project_document_version
  before update of payload on public.tshow_projects
  for each row execute function public.tshow_version_project_document();

drop trigger if exists tshow_project_blocks_materialized on public.tshow_projects;
create trigger tshow_project_blocks_materialized
  after insert or update of payload on public.tshow_projects
  for each row execute function public.tshow_materialize_project_blocks();

-- Materialize all legacy projects once. ON UPDATE also stores their previous
-- document when it changed. A baseline insert below guarantees a recovery
-- point even when PostgreSQL considers the JSON rewrite identical.
update public.tshow_projects set payload = payload || '{}'::jsonb;

insert into public.tshow_project_document_versions(project_id, version, snapshot, created_by, reason)
select p.id, p.document_version, p.payload, p.owner_id, 'normalized_baseline'
from public.tshow_projects p
where p.deleted_at is null
on conflict (project_id, version) do nothing;

drop trigger if exists tshow_project_blocks_updated on public.tshow_project_blocks;
create trigger tshow_project_blocks_updated
  before update on public.tshow_project_blocks
  for each row execute function public.tshow_set_updated_at();
drop trigger if exists tshow_project_comments_updated on public.tshow_project_comments;
create trigger tshow_project_comments_updated
  before update on public.tshow_project_comments
  for each row execute function public.tshow_set_updated_at();

alter table public.tshow_departments enable row level security;
alter table public.tshow_project_blocks enable row level security;
alter table public.tshow_project_document_versions enable row level security;
alter table public.tshow_project_comments enable row level security;
alter table public.tshow_project_assets enable row level security;

revoke all on table public.tshow_departments from anon, authenticated;
revoke all on table public.tshow_project_blocks from anon, authenticated;
revoke all on table public.tshow_project_document_versions from anon, authenticated;
revoke all on table public.tshow_project_comments from anon, authenticated;
revoke all on table public.tshow_project_assets from anon, authenticated;

grant select on table public.tshow_departments to authenticated;
grant select on table public.tshow_project_blocks to authenticated;
grant select on table public.tshow_project_document_versions to authenticated;
grant select on table public.tshow_project_comments to authenticated;
grant select on table public.tshow_project_assets to authenticated;

drop policy if exists tshow_departments_member_read on public.tshow_departments;
create policy tshow_departments_member_read on public.tshow_departments for select to authenticated
using (
  exists (
    select 1 from public.tshow_organization_members m
    where m.organization_id = tshow_departments.organization_id and m.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'platform_admin'
  )
);
drop policy if exists tshow_blocks_member_read on public.tshow_project_blocks;
create policy tshow_blocks_member_read on public.tshow_project_blocks for select to authenticated
using (private.tshow_can_access_project(project_id, 'read'));
drop policy if exists tshow_versions_member_read on public.tshow_project_document_versions;
create policy tshow_versions_member_read on public.tshow_project_document_versions for select to authenticated
using (private.tshow_can_access_project(project_id, 'read'));
drop policy if exists tshow_comments_member_read on public.tshow_project_comments;
create policy tshow_comments_member_read on public.tshow_project_comments for select to authenticated
using (private.tshow_can_access_project(project_id, 'read'));
drop policy if exists tshow_assets_member_read on public.tshow_project_assets;
create policy tshow_assets_member_read on public.tshow_project_assets for select to authenticated
using (private.tshow_can_access_project(project_id, 'read'));

do $$ begin
  alter publication supabase_realtime add table public.tshow_project_blocks;
exception when duplicate_object then null; end $$;

-- Trigger for new accounts. SECURITY DEFINER is required because it provisions
-- related rows during Auth signup; it is kept private and not client-callable.
create or replace function private.tshow_create_personal_organization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare organization uuid;
begin
  insert into public.tshow_organizations
    (name, slug, kind, created_by, billing_owner_id, is_personal)
  values (
    trim(concat(new.first_name, ' ', new.last_name)),
    'personal-' || left(replace(new.id::text, '-', ''), 12),
    'producer', new.id, new.id, true
  )
  on conflict do nothing
  returning id into organization;

  if organization is null then
    select id into organization from public.tshow_organizations
    where slug = 'personal-' || left(replace(new.id::text, '-', ''), 12);
  end if;

  insert into public.tshow_organization_members (organization_id, user_id, role)
  values (organization, new.id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  update public.profiles set default_organization_id = organization where id = new.id;
  return new;
end;
$$;
revoke all on function private.tshow_create_personal_organization() from public, anon, authenticated;

drop trigger if exists tshow_profile_personal_organization on public.profiles;
create trigger tshow_profile_personal_organization
  after insert on public.profiles
  for each row execute function private.tshow_create_personal_organization();
