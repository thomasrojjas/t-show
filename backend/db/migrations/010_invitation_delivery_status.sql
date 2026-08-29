alter table public.tshow_invitations
  add column if not exists delivery_status text not null default 'pending';

alter table public.tshow_invitations
  drop constraint if exists tshow_invitations_delivery_status_check;

alter table public.tshow_invitations
  add constraint tshow_invitations_delivery_status_check
  check (delivery_status in ('pending', 'sent', 'failed', 'not_configured'));

create index if not exists tshow_invitations_delivery_status_idx
  on public.tshow_invitations (project_id, delivery_status);
