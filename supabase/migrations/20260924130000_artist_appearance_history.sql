-- Preserve an audit trail for artist appearance state transitions.
-- Existing appearances are intentionally not backfilled or rewritten.
create table if not exists public.tshow_artist_appearance_events (
  id uuid primary key default gen_random_uuid(),
  appearance_id uuid not null references public.tshow_artist_appearances(id) on delete cascade,
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('expected','on_site','in_dressing_room','ready','finished')),
  changed_by uuid references public.profiles(id) on delete set null,
  note text not null default '' check (char_length(note) <= 2000),
  changed_at timestamptz not null default now()
);

create index if not exists tshow_appearance_events_lookup_idx
  on public.tshow_artist_appearance_events(project_id, appearance_id, changed_at desc);

alter table public.tshow_artist_appearance_events enable row level security;
drop policy if exists tshow_appearance_events_read on public.tshow_artist_appearance_events;
create policy tshow_appearance_events_read
  on public.tshow_artist_appearance_events
  for select to authenticated
  using (private.tshow_can_access_internal_project(project_id, 'read'));

grant select on public.tshow_artist_appearance_events to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.tshow_artist_appearance_events;
exception when duplicate_object then null; end $$;
