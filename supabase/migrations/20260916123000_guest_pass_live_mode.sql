-- Guest Pass can expose either the existing immutable snapshot or a bounded live monitor.
alter table public.tshow_guest_passes
  add column if not exists access_mode text not null default 'snapshot';

do $$ begin
  alter table public.tshow_guest_passes add constraint tshow_guest_passes_access_mode_check
    check (access_mode in ('snapshot', 'live'));
exception when duplicate_object then null; end $$;

create index if not exists tshow_guest_passes_live_idx
  on public.tshow_guest_passes(project_id, expires_at)
  where revoked_at is null and access_mode = 'live';
