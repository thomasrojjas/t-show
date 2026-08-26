-- Restrict internal SECURITY DEFINER/RLS helper functions from the Data API.
revoke execute on function public.tshow_create_profile_for_auth_user() from public, anon, authenticated;
revoke execute on function public.tshow_is_project_member(uuid) from public, anon, authenticated;
alter function public.tshow_set_updated_at() set search_path = public, pg_temp;
