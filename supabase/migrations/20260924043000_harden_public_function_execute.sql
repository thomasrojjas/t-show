-- Harden legacy helper functions exposed through PostgREST.
-- These functions are used by triggers or migrations, not by client RPC calls.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.tshow_effective_project_limit(uuid) from public, anon, authenticated;
revoke execute on function public.tshow_enforce_project_quota() from public, anon, authenticated;

alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.tshow_valid_rut(text) set search_path = public, pg_temp;
