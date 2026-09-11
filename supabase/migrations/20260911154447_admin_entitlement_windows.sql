-- Keep the commercial exception fields and audit history in sync with the
-- superadmin API. This migration is safe for databases that already have
-- any of these objects.
alter table public.profiles
  add column if not exists entitlement_starts_at timestamptz,
  add column if not exists entitlement_expires_at timestamptz;

update public.tshow_account_entitlement_history
set reason = 'Migración de historial sin motivo registrado'
where reason is null or btrim(reason) = '';

alter table public.tshow_account_entitlement_history
  alter column reason set not null,
  alter column new_plan drop not null,
  alter column new_status drop not null;

alter table public.tshow_account_entitlement_history
  add column if not exists old_starts_at timestamptz,
  add column if not exists new_starts_at timestamptz,
  add column if not exists old_expires_at timestamptz,
  add column if not exists new_expires_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.tshow_background_library (
  id uuid primary key default gen_random_uuid(),
  background_key text not null unique,
  title text not null,
  category text not null check (category in ('concert','festival','ceremony','corporate','stage','technical','streaming','backstage')),
  asset_type text not null check (asset_type in ('image','video')),
  asset_url text not null,
  width integer,
  height integer,
  alt_text text not null,
  source_url text,
  author text,
  attribution text,
  license text not null default 'Propio / T-Show',
  darkness numeric(3,2) not null default .55 check (darkness >= 0 and darkness <= 1),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.tshow_background_library enable row level security;
drop policy if exists tshow_background_library_read on public.tshow_background_library;
create policy tshow_background_library_read
  on public.tshow_background_library for select to authenticated
  using (active = true);

insert into public.tshow_background_library
  (background_key,title,category,asset_type,asset_url,width,height,alt_text,license,darkness)
values
  ('workspace-desktop','Escenario en penumbra','stage','video','assets/backgrounds/workspace-desktop-v1.mp4',1920,1080,'Escenario de evento con iluminación tenue','Recurso propio / T-Show',.62),
  ('workspace-mobile','Escenario móvil','stage','video','assets/backgrounds/workspace-mobile-v1.mp4',1080,1920,'Escenario de evento en formato vertical','Recurso propio / T-Show',.62),
  ('live-desktop','Operación en vivo','streaming','video','assets/backgrounds/live-desktop-v1.mp4',1920,1080,'Cabina y escenario para operación en vivo','Recurso propio / T-Show',.68)
on conflict (background_key) do update
set asset_url = excluded.asset_url, alt_text = excluded.alt_text;

create index if not exists tshow_background_library_category_idx
  on public.tshow_background_library(category) where active = true;
