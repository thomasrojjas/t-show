-- Recordatorios de inicio de evento. La marca única evita envíos duplicados
-- incluso si Render reintenta la tarea o existen dos instancias concurrentes.
create table if not exists public.tshow_event_reminders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  event_start_at timestamptz not null,
  reminder_minutes integer not null default 15 check (reminder_minutes between 1 and 1440),
  delivery_status text not null default 'claimed' check (delivery_status in ('claimed','sent','failed','not_configured')),
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  recipient_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  unique (project_id, event_start_at, reminder_minutes)
);

create index if not exists tshow_event_reminders_status_idx
  on public.tshow_event_reminders (delivery_status, event_start_at);

alter table public.tshow_event_reminders enable row level security;
revoke all on public.tshow_event_reminders from anon, authenticated;

create or replace function public.claim_event_start_reminders(
  p_now timestamptz default now(),
  p_minutes integer default 15
)
returns table(project_id uuid, event_start_at timestamptz, event_name text, payload jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  start_at timestamptz;
begin
  if p_minutes < 1 or p_minutes > 1440 then
    raise exception 'Invalid reminder interval';
  end if;
  for item in
    select p.id, p.event_name, p.payload
    from public.tshow_projects p
    where p.deleted_at is null
      and coalesce(p.payload->>'eventDate', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and coalesce(p.payload->>'showStartTimeInput', p.payload->>'showStartTime', '') ~ '^[0-9]{2}:[0-9]{2}$'
  loop
    begin
      start_at := (item.payload->>'eventDate' || ' ' || coalesce(item.payload->>'showStartTimeInput', item.payload->>'showStartTime'))::timestamp
        at time zone 'America/Santiago';
    exception when others then
      continue;
    end;
    if start_at > p_now + make_interval(mins => p_minutes - 1)
       and start_at <= p_now + make_interval(mins => p_minutes + 1) then
      insert into public.tshow_event_reminders(project_id, event_start_at, reminder_minutes)
      values (item.id, start_at, p_minutes)
      on conflict (project_id, event_start_at, reminder_minutes) do nothing;
      if found then
        project_id := item.id;
        event_start_at := start_at;
        event_name := item.event_name;
        payload := item.payload;
        return next;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.claim_event_start_reminders(timestamptz, integer) from public;
grant execute on function public.claim_event_start_reminders(timestamptz, integer) to service_role;
