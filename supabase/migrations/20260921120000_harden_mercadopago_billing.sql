-- Additive billing hardening. Existing attempts, subscriptions and webhooks remain valid.
alter table public.tshow_payment_attempts
  add column if not exists checkout_url text,
  add column if not exists provider_request_id text,
  add column if not exists provider_http_status integer,
  add column if not exists last_provider_error text;

-- Existing payment attempts are historical records and may contain duplicate
-- in-flight rows. Reserve new work in a separate table so this migration does
-- not rewrite or silently reclassify those records.
create table if not exists public.tshow_payment_attempt_reservations (
  account_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('mercadopago_bricks','mercadopago_checkout_pro','mercadopago_subscription','flow')),
  attempt_id uuid not null unique references public.tshow_payment_attempts(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, provider)
);
alter table public.tshow_payment_attempt_reservations enable row level security;
revoke all on public.tshow_payment_attempt_reservations from anon, authenticated;
create index if not exists tshow_payment_attempt_reservations_attempt_idx
  on public.tshow_payment_attempt_reservations(attempt_id);

create index if not exists tshow_payment_attempts_provider_request_idx
  on public.tshow_payment_attempts(provider_request_id)
  where provider_request_id is not null;
