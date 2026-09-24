create table if not exists public.tshow_operational_feature_flags (
  project_id uuid primary key references public.tshow_projects(id) on delete cascade,
  enabled boolean not null default false,
  enabled_by uuid references public.profiles(id) on delete set null,
  enabled_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.tshow_operational_feature_flags enable row level security;
grant select on public.tshow_operational_feature_flags to authenticated;
drop policy if exists tshow_operational_flags_read on public.tshow_operational_feature_flags;
create policy tshow_operational_flags_read on public.tshow_operational_feature_flags for select to authenticated using (private.tshow_can_access_internal_project(project_id,'read'));
