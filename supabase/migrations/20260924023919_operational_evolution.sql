-- Operational evolution: additive event operations, rehearsal and offline-ready data.
-- Shared writes are mediated by the authenticated API; RLS protects direct reads
-- and Realtime delivery without granting platform administrators implicit access.
create schema if not exists private;

create or replace function private.tshow_can_access_internal_project(target_project uuid, required_access text default 'read')
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.tshow_projects p
    left join public.tshow_project_members pm on pm.project_id = p.id and pm.user_id = (select auth.uid())
    left join public.tshow_organization_members om on om.organization_id = p.organization_id and om.user_id = (select auth.uid())
    where p.id = target_project and p.deleted_at is null
      and (p.owner_id = (select auth.uid()) or pm.user_id is not null or om.role in ('owner','admin'))
      and (required_access = 'read' or p.owner_id = (select auth.uid()) or pm.role = 'editor' or om.role in ('owner','admin'))
  );
$$;
revoke all on function private.tshow_can_access_internal_project(uuid,text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.tshow_can_access_internal_project(uuid,text) to authenticated;

create table if not exists public.tshow_project_areas (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.tshow_projects(id) on delete cascade,
  area_key text not null check (char_length(trim(area_key)) between 2 and 60), name text not null check (char_length(trim(name)) between 2 and 100),
  status text not null default 'active' check (status in ('active','archived')), created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(project_id, area_key)
);
create table if not exists public.tshow_project_area_members (
  area_id uuid not null references public.tshow_project_areas(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade,
  can_update boolean not null default true, created_at timestamptz not null default now(), primary key(area_id,user_id)
);
create table if not exists public.tshow_technical_cues (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.tshow_projects(id) on delete cascade,
  block_id uuid references public.tshow_project_blocks(id) on delete set null, area_id uuid not null references public.tshow_project_areas(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 4000), version bigint not null default 1,
  updated_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(project_id, block_id, area_id)
);
create table if not exists public.tshow_block_area_readiness (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.tshow_projects(id) on delete cascade,
  block_id uuid not null references public.tshow_project_blocks(id) on delete cascade, area_id uuid not null references public.tshow_project_areas(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','preparing','ready','problem','not_applicable')),
  note text not null default '' check (char_length(note) <= 2000), confirmed_by uuid references public.profiles(id) on delete set null, confirmed_at timestamptz,
  source_version bigint not null default 1, updated_at timestamptz not null default now(), unique(block_id, area_id)
);
create table if not exists public.tshow_artists (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.tshow_projects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 180), kind text not null default 'artist', notes text not null default '' check (char_length(notes) <= 4000),
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.tshow_artist_appearances (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.tshow_projects(id) on delete cascade,
  artist_id uuid not null references public.tshow_artists(id) on delete cascade, block_id uuid references public.tshow_project_blocks(id) on delete set null,
  call_time text, dressing_room text, responsible_id uuid references public.profiles(id) on delete set null,
  status text not null default 'expected' check (status in ('expected','on_site','in_dressing_room','ready','finished')),
  updated_by uuid references public.profiles(id) on delete set null, updated_at timestamptz not null default now()
);
create table if not exists public.tshow_operational_notices (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.tshow_projects(id) on delete cascade,
  block_id uuid references public.tshow_project_blocks(id) on delete set null, area_id uuid references public.tshow_project_areas(id) on delete set null,
  title text not null check (char_length(trim(title)) between 2 and 180), body text not null check (char_length(trim(body)) between 1 and 2000),
  created_by uuid not null references public.profiles(id) on delete restrict, idempotency_key text, created_at timestamptz not null default now()
);
create unique index if not exists tshow_notice_idempotency_idx on public.tshow_operational_notices(project_id, idempotency_key) where idempotency_key is not null;
create table if not exists public.tshow_operational_notice_recipients (
  notice_id uuid not null references public.tshow_operational_notices(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade,
  seen_at timestamptz, confirmed_at timestamptz, created_at timestamptz not null default now(), primary key(notice_id,user_id)
);
create table if not exists public.tshow_rehearsals (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.tshow_projects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 180), status text not null default 'draft' check (status in ('draft','running','paused','finished','cancelled')),
  simulated_now timestamptz, source_document_version bigint not null default 1, created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.tshow_timing_adjustments (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.tshow_projects(id) on delete cascade,
  base_document_version bigint not null, preview jsonb not null default '{}'::jsonb, status text not null default 'preview' check (status in ('preview','applied','rejected')),
  created_by uuid not null references public.profiles(id) on delete restrict, applied_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), applied_at timestamptz
);

create index if not exists tshow_project_areas_project_idx on public.tshow_project_areas(project_id,status);
create index if not exists tshow_cues_project_block_idx on public.tshow_technical_cues(project_id,block_id,area_id);
create index if not exists tshow_readiness_project_block_idx on public.tshow_block_area_readiness(project_id,block_id,status);
create index if not exists tshow_artists_project_idx on public.tshow_artists(project_id,name);
create index if not exists tshow_appearances_project_idx on public.tshow_artist_appearances(project_id,block_id,status);
create index if not exists tshow_notices_project_idx on public.tshow_operational_notices(project_id,created_at desc);
create index if not exists tshow_notice_recipient_idx on public.tshow_operational_notice_recipients(user_id,confirmed_at);
create index if not exists tshow_rehearsals_project_idx on public.tshow_rehearsals(project_id,created_at desc);

grant select on public.tshow_project_areas, public.tshow_project_area_members, public.tshow_technical_cues,
  public.tshow_block_area_readiness, public.tshow_artists, public.tshow_artist_appearances,
  public.tshow_operational_notices, public.tshow_operational_notice_recipients,
  public.tshow_rehearsals, public.tshow_timing_adjustments to authenticated;

do $$ declare t text; begin
  foreach t in array array['tshow_project_areas','tshow_project_area_members','tshow_technical_cues','tshow_block_area_readiness','tshow_artists','tshow_artist_appearances','tshow_operational_notices','tshow_operational_notice_recipients','tshow_rehearsals','tshow_timing_adjustments'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

drop policy if exists tshow_project_areas_read on public.tshow_project_areas;
create policy tshow_project_areas_read on public.tshow_project_areas for select to authenticated using (private.tshow_can_access_internal_project(project_id,'read'));
drop policy if exists tshow_project_area_members_read on public.tshow_project_area_members;
create policy tshow_project_area_members_read on public.tshow_project_area_members for select to authenticated using (exists(select 1 from public.tshow_project_areas a where a.id=area_id and private.tshow_can_access_internal_project(a.project_id,'read')));
drop policy if exists tshow_technical_cues_read on public.tshow_technical_cues;
create policy tshow_technical_cues_read on public.tshow_technical_cues for select to authenticated using (private.tshow_can_access_internal_project(project_id,'read'));
drop policy if exists tshow_readiness_read on public.tshow_block_area_readiness;
create policy tshow_readiness_read on public.tshow_block_area_readiness for select to authenticated using (private.tshow_can_access_internal_project(project_id,'read'));
drop policy if exists tshow_artists_read on public.tshow_artists;
create policy tshow_artists_read on public.tshow_artists for select to authenticated using (private.tshow_can_access_internal_project(project_id,'read'));
drop policy if exists tshow_appearances_read on public.tshow_artist_appearances;
create policy tshow_appearances_read on public.tshow_artist_appearances for select to authenticated using (private.tshow_can_access_internal_project(project_id,'read'));
drop policy if exists tshow_notices_read on public.tshow_operational_notices;
create policy tshow_notices_read on public.tshow_operational_notices for select to authenticated using (private.tshow_can_access_internal_project(project_id,'read'));
drop policy if exists tshow_notice_recipients_read on public.tshow_operational_notice_recipients;
create policy tshow_notice_recipients_read on public.tshow_operational_notice_recipients for select to authenticated using (exists(select 1 from public.tshow_operational_notices n where n.id=notice_id and private.tshow_can_access_internal_project(n.project_id,'read')));
drop policy if exists tshow_rehearsals_read on public.tshow_rehearsals;
create policy tshow_rehearsals_read on public.tshow_rehearsals for select to authenticated using (private.tshow_can_access_internal_project(project_id,'read'));
drop policy if exists tshow_adjustments_read on public.tshow_timing_adjustments;
create policy tshow_adjustments_read on public.tshow_timing_adjustments for select to authenticated using (private.tshow_can_access_internal_project(project_id,'read'));

do $$ begin
  alter publication supabase_realtime add table public.tshow_project_areas;
  alter publication supabase_realtime add table public.tshow_block_area_readiness;
  alter publication supabase_realtime add table public.tshow_operational_notices;
  alter publication supabase_realtime add table public.tshow_operational_notice_recipients;
exception when duplicate_object then null; end $$;
