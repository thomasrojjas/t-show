alter table public.tshow_tasks
  add column if not exists area_id uuid references public.tshow_project_areas(id) on delete set null,
  add column if not exists task_kind text not null default 'operational',
  add column if not exists not_applicable_reason text not null default '',
  add column if not exists blocked_reason text not null default '',
  add column if not exists last_changed_by uuid references public.profiles(id) on delete set null;

create table if not exists public.tshow_task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tshow_tasks(id) on delete cascade,
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  from_status text,
  to_status text not null,
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists tshow_tasks_area_idx on public.tshow_tasks(project_id,area_id,status);
create index if not exists tshow_tasks_last_changed_by_idx on public.tshow_tasks(last_changed_by);
create index if not exists tshow_task_events_task_idx on public.tshow_task_events(task_id,created_at desc);
create index if not exists tshow_task_events_project_idx on public.tshow_task_events(project_id,created_at desc);
alter table public.tshow_task_events enable row level security;
grant select on public.tshow_task_events to authenticated;
drop policy if exists tshow_task_events_read on public.tshow_task_events;
create policy tshow_task_events_read on public.tshow_task_events for select to authenticated using (private.tshow_can_access_internal_project(project_id,'read'));
