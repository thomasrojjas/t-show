-- Hardening for account quotas, invitations and block notes.
-- Safe to run repeatedly after migrations 001-018.

create index if not exists tshow_projects_owner_active_idx
  on public.tshow_projects(owner_id, updated_at desc)
  where deleted_at is null;

create index if not exists tshow_invitations_project_status_idx
  on public.tshow_invitations(project_id, status, expires_at);

create index if not exists tshow_invitations_email_status_idx
  on public.tshow_invitations(lower(email), status);

-- Keep the newest pending invitation when older data contains duplicates.
with ranked as (
  select id, row_number() over (
    partition by project_id, lower(email) order by created_at desc, id desc
  ) as position
  from public.tshow_invitations
  where status = 'pending'
)
update public.tshow_invitations i
set status = 'revoked'
from ranked r
where i.id = r.id and r.position > 1;

create unique index if not exists tshow_invitations_pending_email_uidx
  on public.tshow_invitations(project_id, lower(email))
  where status = 'pending';

do $$ begin
  alter table public.tshow_invitations add constraint tshow_invitations_status_check
    check (status in ('pending','sent','accepted','revoked','expired','failed','not_configured'));
exception when duplicate_object then null; end $$;

-- Notes remain in the project payload for compatibility with legacy documents;
-- this index supports project-level reads without creating a second source of truth.
create index if not exists tshow_projects_payload_gin_idx
  on public.tshow_projects using gin (payload);

alter table public.tshow_account_entitlement_history enable row level security;
