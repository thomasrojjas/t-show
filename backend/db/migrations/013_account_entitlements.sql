-- Account entitlements and commercial project limits.
-- Idempotent: safe to run after migrations 001-012.

alter table public.profiles
  add column if not exists account_plan text not null default 'free',
  add column if not exists custom_project_limit integer,
  add column if not exists commercial_status text not null default 'free',
  add column if not exists entitlement_updated_at timestamptz,
  add column if not exists entitlement_updated_by uuid references public.profiles(id) on delete set null;

do $$ begin
  alter table public.profiles add constraint profiles_account_plan_check
    check (account_plan in ('free','pro','max','enterprise'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_commercial_status_check
    check (commercial_status in ('free','active','expired','cancelled','read_only'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_custom_project_limit_check
    check (custom_project_limit is null or custom_project_limit >= 1);
exception when duplicate_object then null; end $$;

create index if not exists profiles_entitlement_idx
  on public.profiles(account_plan, commercial_status);

create table if not exists public.tshow_account_entitlement_history (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.profiles(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  old_plan text,
  new_plan text not null,
  old_limit integer,
  new_limit integer,
  old_status text,
  new_status text not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists tshow_entitlement_history_account_idx
  on public.tshow_account_entitlement_history(account_id, created_at desc);
alter table public.tshow_account_entitlement_history enable row level security;

alter table public.tshow_plans
  add column if not exists project_limit integer,
  add column if not exists discount_percent numeric(5,2) not null default 0;
do $$ begin
  alter table public.tshow_plans add constraint tshow_plans_project_limit_check
    check (project_limit is null or project_limit >= 1);
exception when duplicate_object then null; end $$;

-- Keep the original inactive placeholders for compatibility, while providing
-- explicit commercial products for the public catalog and payment providers.
insert into public.tshow_plans (code, name, interval, amount_clp, active, benefits, project_limit, discount_percent)
values
  ('pro_monthly', 'Pro mensual', 'month', 29990, false, '["Hasta 20 proyectos","Colaboración por equipo","Operación en vivo"]'::jsonb, 20, 0),
  ('pro_annual', 'Pro anual', 'year', 251916, false, '["Hasta 20 proyectos","Colaboración por equipo","Operación en vivo","30% de descuento"]'::jsonb, 20, 30),
  ('max_monthly', 'Max mensual', 'month', 49990, false, '["Hasta 50 proyectos","Equipos ampliados","Operación en vivo"]'::jsonb, 50, 0),
  ('max_annual', 'Max anual', 'year', 419916, false, '["Hasta 50 proyectos","Equipos ampliados","Operación en vivo","30% de descuento"]'::jsonb, 50, 30),
  ('enterprise', 'Empresa', 'month', null, false, '["Proyectos ilimitados","Acompañamiento comercial","Configuración a medida"]'::jsonb, null, 0)
on conflict (code) do update set
  project_limit = excluded.project_limit,
  discount_percent = excluded.discount_percent,
  benefits = excluded.benefits;

create or replace function public.tshow_effective_project_limit(account uuid)
returns integer language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p record; sub_limit integer; result integer;
begin
  select account_plan, custom_project_limit, commercial_status into p from public.profiles where id = account;
  if not found then return 1; end if;
  if p.custom_project_limit is not null then return p.custom_project_limit; end if;
  if p.account_plan = 'enterprise' then return null; end if;
  if p.account_plan = 'max' then return 50; end if;
  if p.account_plan = 'pro' then return 20; end if;
  select pl.project_limit into sub_limit
    from public.tshow_subscriptions s join public.tshow_plans pl on pl.id = s.plan_id
    where s.account_id = account and s.status = 'active'
    order by s.updated_at desc limit 1;
  result := coalesce(sub_limit, 1);
  return result;
end;
$$;

create or replace function public.tshow_enforce_project_quota()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare project_count integer; project_limit integer; account_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('tshow-project-quota:' || new.owner_id::text, 0));
  select commercial_status into account_status from public.profiles where id = new.owner_id;
  if account_status in ('read_only','expired','cancelled') then
    raise exception using errcode = 'check_violation', message = 'Tu cuenta no puede crear proyectos mientras está en modo lectura.';
  end if;
  project_limit := public.tshow_effective_project_limit(new.owner_id);
  if project_limit is null then return new; end if;
  select count(*) into project_count from public.tshow_projects
    where owner_id = new.owner_id and deleted_at is null;
  if project_count >= project_limit then
    raise exception using errcode = 'check_violation', message = 'Tu cuenta ha alcanzado el límite de proyectos de su plan.';
  end if;
  return new;
end;
$$;
drop trigger if exists tshow_project_quota on public.tshow_projects;
create trigger tshow_project_quota before insert on public.tshow_projects
  for each row execute function public.tshow_enforce_project_quota();

