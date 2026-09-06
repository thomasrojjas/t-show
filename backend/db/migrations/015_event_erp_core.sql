-- T-Show event ERP core: commercial, financial and operational records.
-- All client writes are mediated by the API; authenticated clients receive
-- read-only access constrained by organization/project membership.

create or replace function private.tshow_can_access_organization(target_organization uuid, required_access text default 'read')
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tshow_organization_members m
    where m.organization_id = target_organization
      and m.user_id = (select auth.uid())
      and (required_access = 'read' or m.role in ('owner', 'admin'))
  ) or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'platform_admin'
  );
$$;
revoke all on function private.tshow_can_access_organization(uuid, text) from public, anon;
grant execute on function private.tshow_can_access_organization(uuid, text) to authenticated;

create table if not exists public.tshow_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.tshow_organizations(id) on delete cascade,
  legal_name text not null check (char_length(trim(legal_name)) between 2 and 180),
  trade_name text,
  tax_id text,
  email text,
  phone text,
  address text,
  notes text not null default '' check (char_length(notes) <= 4000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists tshow_clients_org_idx on public.tshow_clients(organization_id, legal_name) where archived_at is null;

create table if not exists public.tshow_venues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.tshow_organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 180),
  address text,
  city text,
  capacity integer check (capacity is null or capacity >= 0),
  contact_name text,
  contact_email text,
  contact_phone text,
  technical_notes text not null default '' check (char_length(technical_notes) <= 8000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists tshow_venues_org_idx on public.tshow_venues(organization_id, name) where archived_at is null;

create table if not exists public.tshow_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.tshow_organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 180),
  category text not null default 'other',
  tax_id text,
  email text,
  phone text,
  contact_name text,
  notes text not null default '' check (char_length(notes) <= 4000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists tshow_suppliers_org_idx on public.tshow_suppliers(organization_id, category, name) where archived_at is null;

create table if not exists public.tshow_event_finances (
  project_id uuid primary key references public.tshow_projects(id) on delete cascade,
  currency text not null default 'CLP' check (currency ~ '^[A-Z]{3}$'),
  budget_amount bigint not null default 0 check (budget_amount >= 0),
  contingency_amount bigint not null default 0 check (contingency_amount >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tshow_expenses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  supplier_id uuid references public.tshow_suppliers(id) on delete set null,
  category text not null default 'other',
  description text not null check (char_length(trim(description)) between 2 and 240),
  amount bigint not null check (amount >= 0),
  status text not null default 'planned' check (status in ('planned','approved','paid','cancelled')),
  due_at date,
  paid_at timestamptz,
  receipt_key text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tshow_expenses_project_idx on public.tshow_expenses(project_id, status, created_at desc);

create table if not exists public.tshow_quotes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  client_id uuid references public.tshow_clients(id) on delete set null,
  number text not null,
  status text not null default 'draft' check (status in ('draft','sent','accepted','rejected','expired','cancelled')),
  currency text not null default 'CLP' check (currency ~ '^[A-Z]{3}$'),
  valid_until date,
  notes text not null default '' check (char_length(notes) <= 4000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, number)
);
create table if not exists public.tshow_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.tshow_quotes(id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  description text not null check (char_length(trim(description)) between 1 and 240),
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_price bigint not null default 0 check (unit_price >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  unique(quote_id, position)
);
create index if not exists tshow_quotes_project_idx on public.tshow_quotes(project_id, status, created_at desc);

create table if not exists public.tshow_contracts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  client_id uuid references public.tshow_clients(id) on delete set null,
  title text not null check (char_length(trim(title)) between 2 and 180),
  status text not null default 'draft' check (status in ('draft','review','signed','cancelled','expired')),
  value_amount bigint check (value_amount is null or value_amount >= 0),
  signed_at timestamptz,
  expires_at date,
  file_key text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tshow_contracts_project_idx on public.tshow_contracts(project_id, status, created_at desc);

create table if not exists public.tshow_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 180),
  description text not null default '' check (char_length(description) <= 4000),
  status text not null default 'pending' check (status in ('pending','in_progress','blocked','completed','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  assigned_to uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tshow_tasks_project_idx on public.tshow_tasks(project_id, status, due_at);

create table if not exists public.tshow_calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.tshow_organizations(id) on delete cascade,
  project_id uuid references public.tshow_projects(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 180),
  event_type text not null default 'meeting',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  description text not null default '' check (char_length(description) <= 4000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists tshow_calendar_org_idx on public.tshow_calendar_events(organization_id, starts_at);
create index if not exists tshow_calendar_project_idx on public.tshow_calendar_events(project_id, starts_at) where project_id is not null;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'tshow_clients','tshow_venues','tshow_suppliers','tshow_event_finances',
    'tshow_expenses','tshow_quotes','tshow_contracts','tshow_tasks','tshow_calendar_events'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_updated', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.tshow_set_updated_at()', table_name || '_updated', table_name);
  end loop;
end $$;

alter table public.tshow_clients enable row level security;
alter table public.tshow_venues enable row level security;
alter table public.tshow_suppliers enable row level security;
alter table public.tshow_event_finances enable row level security;
alter table public.tshow_expenses enable row level security;
alter table public.tshow_quotes enable row level security;
alter table public.tshow_quote_items enable row level security;
alter table public.tshow_contracts enable row level security;
alter table public.tshow_tasks enable row level security;
alter table public.tshow_calendar_events enable row level security;

revoke all on public.tshow_clients, public.tshow_venues, public.tshow_suppliers,
  public.tshow_event_finances, public.tshow_expenses, public.tshow_quotes,
  public.tshow_quote_items, public.tshow_contracts, public.tshow_tasks,
  public.tshow_calendar_events from anon, authenticated;
grant select on public.tshow_clients, public.tshow_venues, public.tshow_suppliers,
  public.tshow_event_finances, public.tshow_expenses, public.tshow_quotes,
  public.tshow_quote_items, public.tshow_contracts, public.tshow_tasks,
  public.tshow_calendar_events to authenticated;

drop policy if exists tshow_clients_read on public.tshow_clients;
create policy tshow_clients_read on public.tshow_clients for select to authenticated using (private.tshow_can_access_organization(organization_id, 'read'));
drop policy if exists tshow_venues_read on public.tshow_venues;
create policy tshow_venues_read on public.tshow_venues for select to authenticated using (private.tshow_can_access_organization(organization_id, 'read'));
drop policy if exists tshow_suppliers_read on public.tshow_suppliers;
create policy tshow_suppliers_read on public.tshow_suppliers for select to authenticated using (private.tshow_can_access_organization(organization_id, 'read'));
drop policy if exists tshow_finances_read on public.tshow_event_finances;
create policy tshow_finances_read on public.tshow_event_finances for select to authenticated using (private.tshow_can_access_project(project_id, 'read'));
drop policy if exists tshow_expenses_read on public.tshow_expenses;
create policy tshow_expenses_read on public.tshow_expenses for select to authenticated using (private.tshow_can_access_project(project_id, 'read'));
drop policy if exists tshow_quotes_read on public.tshow_quotes;
create policy tshow_quotes_read on public.tshow_quotes for select to authenticated using (private.tshow_can_access_project(project_id, 'read'));
drop policy if exists tshow_quote_items_read on public.tshow_quote_items;
create policy tshow_quote_items_read on public.tshow_quote_items for select to authenticated using (exists (select 1 from public.tshow_quotes q where q.id = quote_id and private.tshow_can_access_project(q.project_id, 'read')));
drop policy if exists tshow_contracts_read on public.tshow_contracts;
create policy tshow_contracts_read on public.tshow_contracts for select to authenticated using (private.tshow_can_access_project(project_id, 'read'));
drop policy if exists tshow_tasks_read on public.tshow_tasks;
create policy tshow_tasks_read on public.tshow_tasks for select to authenticated using (private.tshow_can_access_project(project_id, 'read'));
drop policy if exists tshow_calendar_read on public.tshow_calendar_events;
create policy tshow_calendar_read on public.tshow_calendar_events for select to authenticated using (
  private.tshow_can_access_organization(organization_id, 'read')
  and (project_id is null or private.tshow_can_access_project(project_id, 'read'))
);

do $$ begin alter publication supabase_realtime add table public.tshow_tasks; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tshow_calendar_events; exception when duplicate_object then null; end $$;
