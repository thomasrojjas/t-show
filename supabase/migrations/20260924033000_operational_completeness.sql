-- Complete the operational model without rewriting existing event data.
alter table public.tshow_project_areas
  add column if not exists responsible_id uuid references public.profiles(id) on delete set null;

alter table public.tshow_rehearsals
  add column if not exists snapshot jsonb not null default '{}'::jsonb,
  add column if not exists current_index integer not null default 0,
  add column if not exists elapsed_seconds integer not null default 0;

alter table public.tshow_operational_notices
  add column if not exists acknowledged_at timestamptz;

create index if not exists tshow_areas_responsible_idx
  on public.tshow_project_areas(responsible_id);
create index if not exists tshow_rehearsals_status_idx
  on public.tshow_rehearsals(project_id,status,updated_at desc);

alter table public.tshow_project_areas enable row level security;
alter table public.tshow_rehearsals enable row level security;

-- Realtime consumers only need the operational rows already covered by the
-- project access function; service writes remain behind the authenticated API.
