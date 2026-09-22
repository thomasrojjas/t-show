-- Consolidate chat read/write policies so Supabase does not evaluate two
-- permissive policies for SELECT on the same user-owned rows.
drop policy if exists chat_reads_self_read on public.tshow_chat_reads;
drop policy if exists chat_reads_self_write on public.tshow_chat_reads;
create policy chat_reads_self_access on public.tshow_chat_reads
  for all to authenticated
  using (user_id = (select auth.uid()) and public.tshow_is_project_member(project_id))
  with check (user_id = (select auth.uid()) and public.tshow_is_project_member(project_id));

drop policy if exists chat_preferences_self_read on public.tshow_chat_preferences;
drop policy if exists chat_preferences_self_write on public.tshow_chat_preferences;
create policy chat_preferences_self_access on public.tshow_chat_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
