-- Invitation integrity and lookup performance.
-- Tokens remain SHA-256 hashes; this migration adds no credential storage.

create unique index if not exists tshow_invitations_pending_project_email_uidx
  on public.tshow_invitations (project_id, lower(email))
  where status = 'pending';

create index if not exists tshow_project_members_project_created_idx
  on public.tshow_project_members (project_id, created_at);

create index if not exists tshow_invitations_project_status_idx
  on public.tshow_invitations (project_id, status, expires_at);

create index if not exists tshow_invitations_token_hash_idx
  on public.tshow_invitations (token_hash);
