-- Explicit read/write policies for operational tables. Service-role API remains authoritative.
do $$ begin
  create policy tshow_org_member_read on public.tshow_organizations for select to authenticated
    using (exists (select 1 from public.tshow_organization_members m where m.organization_id=id and m.user_id=auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy tshow_org_members_read on public.tshow_organization_members for select to authenticated
    using (user_id=auth.uid() or exists (select 1 from public.tshow_organization_members m where m.organization_id=tshow_organization_members.organization_id and m.user_id=auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy tshow_approval_project_access on public.tshow_project_approvals for select to authenticated using (public.tshow_is_project_member(project_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy tshow_approval_history_project_access on public.tshow_project_approval_history for select to authenticated using (public.tshow_is_project_member(project_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy tshow_requirements_project_access on public.tshow_project_requirements for select to authenticated using (public.tshow_is_project_member(project_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy tshow_incidents_project_access on public.tshow_incidents for select to authenticated using (public.tshow_is_project_member(project_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy tshow_incident_actions_project_access on public.tshow_incident_actions for select to authenticated using (exists (select 1 from public.tshow_incidents i where i.id=incident_id and public.tshow_is_project_member(i.project_id)));
exception when duplicate_object then null; end $$;
