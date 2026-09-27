-- Pricing catalog v2 for the Chilean event-production offer.
-- Additive: legacy plans remain available for reconciliation/audit but are
-- removed from new sales without changing historical attempts.

alter table public.tshow_plans
  add column if not exists tier text,
  add column if not exists catalog_version integer not null default 1,
  add column if not exists sales_mode text not null default 'self_service',
  add column if not exists checkout_enabled boolean not null default true,
  add column if not exists catalog_visible boolean not null default true,
  add column if not exists member_limit integer,
  add column if not exists event_limit_kind text not null default 'simultaneous_active',
  add column if not exists hardware_units integer not null default 0,
  add column if not exists hardware_terms text;

do $$ begin
  alter table public.tshow_plans add constraint tshow_plans_tier_check
    check (tier is null or tier in ('starter','pro','max','enterprise'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tshow_plans add constraint tshow_plans_sales_mode_check
    check (sales_mode in ('free','self_service','assisted','quote'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tshow_plans add constraint tshow_plans_event_limit_kind_check
    check (event_limit_kind in ('simultaneous_active','unlimited'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tshow_plans add constraint tshow_plans_member_limit_check
    check (member_limit is null or member_limit >= 1);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tshow_plans add constraint tshow_plans_hardware_units_check
    check (hardware_units >= 0);
exception when duplicate_object then null; end $$;

create index if not exists tshow_plans_catalog_idx
  on public.tshow_plans (catalog_visible, active, tier, interval);

insert into public.tshow_plans
  (code, name, interval, amount_clp, active, benefits, project_limit,
   discount_percent, tier, catalog_version, sales_mode, checkout_enabled,
   catalog_visible, member_limit, event_limit_kind, hardware_units, hardware_terms)
values
  ('starter_v2', 'Starter', 'month', null, true,
   '["1 evento activo","Escaleta, guion y operación en vivo","Hasta 3 integrantes por evento"]'::jsonb,
   1, 0, 'starter', 2, 'free', false, true, 3, 'simultaneous_active', 0,
   'Sin PASSLINK ni hardware.'),
  ('pro_box_office_monthly_v2', 'Pro Box Office mensual', 'month', 49990, true,
   '["Hasta 10 eventos activos","PASSLINK y accesos QR","1 ticketera POS incluida, sujeta a contrato y disponibilidad","Equipo ilimitado"]'::jsonb,
   10, 0, 'pro', 2, 'assisted', false, true, null, 'simultaneous_active', 1,
   'Venta asistida: stock, comodato, garantía y despacho se confirman antes de activar.'),
  ('pro_box_office_annual_v2', 'Pro Box Office anual', 'year', 419916, true,
   '["Hasta 10 eventos activos","PASSLINK y accesos QR","1 ticketera POS incluida, sujeta a contrato y disponibilidad","Equipo ilimitado","30% de descuento"]'::jsonb,
   10, 30, 'pro', 2, 'assisted', false, true, null, 'simultaneous_active', 1,
   'Venta asistida: stock, comodato, garantía y despacho se confirman antes de activar.'),
  ('max_productora_monthly_v2', 'Max Productora mensual', 'month', 89990, true,
   '["Hasta 30 eventos activos","Todo Pro Box Office","2 ticketeras POS incluidas, sujetas a contrato y disponibilidad","Operación ampliada"]'::jsonb,
   30, 0, 'max', 2, 'assisted', false, true, null, 'simultaneous_active', 2,
   'Venta asistida: stock, comodato, garantía y despacho se confirman antes de activar.'),
  ('max_productora_annual_v2', 'Max Productora anual', 'year', 755916, true,
   '["Hasta 30 eventos activos","Todo Pro Box Office","2 ticketeras POS incluidas, sujetas a contrato y disponibilidad","Operación ampliada","30% de descuento"]'::jsonb,
   30, 30, 'max', 2, 'assisted', false, true, null, 'simultaneous_active', 2,
   'Venta asistida: stock, comodato, garantía y despacho se confirman antes de activar.'),
  ('venue_enterprise_v2', 'Venue / Empresa', 'month', 169990, true,
   '["Eventos ilimitados","Pack de hardware desde 3 equipos","Configuración multi-recinto","Integraciones y acompañamiento sujetos a cotización"]'::jsonb,
   null, 0, 'enterprise', 2, 'quote', false, true, null, 'unlimited', 3,
   'Desde $169.990 IVA incluido. El alcance final se define en una propuesta comercial.')
on conflict (code) do update set
  name = excluded.name,
  interval = excluded.interval,
  amount_clp = excluded.amount_clp,
  active = excluded.active,
  benefits = excluded.benefits,
  project_limit = excluded.project_limit,
  discount_percent = excluded.discount_percent,
  tier = excluded.tier,
  catalog_version = excluded.catalog_version,
  sales_mode = excluded.sales_mode,
  checkout_enabled = excluded.checkout_enabled,
  catalog_visible = excluded.catalog_visible,
  member_limit = excluded.member_limit,
  event_limit_kind = excluded.event_limit_kind,
  hardware_units = excluded.hardware_units,
  hardware_terms = excluded.hardware_terms;

-- Do not mutate old amounts: payment attempts retain their immutable snapshot.
update public.tshow_plans
set active = false, catalog_visible = false, checkout_enabled = false
where code in ('pro_monthly','pro_annual','max_monthly','max_annual','monthly','annual')
  and coalesce(catalog_version, 1) < 2;

-- Starter is represented in the public catalog but is not a paid checkout plan.
update public.tshow_plans
set sales_mode = 'free', checkout_enabled = false, catalog_visible = false
where code in ('monthly','annual');

create or replace function public.tshow_effective_project_limit(account uuid)
returns integer language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p record; sub_limit integer; result integer;
begin
  select account_plan, custom_project_limit, commercial_status into p from public.profiles where id = account;
  if not found then return 1; end if;
  if p.custom_project_limit is not null then return p.custom_project_limit; end if;
  if p.account_plan = 'enterprise' then return null; end if;
  if p.account_plan = 'max' then return 30; end if;
  if p.account_plan = 'pro' then return 10; end if;
  select pl.project_limit into sub_limit
    from public.tshow_subscriptions s join public.tshow_plans pl on pl.id = s.plan_id
    where s.account_id = account and s.status = 'active'
    order by s.updated_at desc limit 1;
  result := coalesce(sub_limit, 1);
  return result;
end;
$$;
