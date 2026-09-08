-- Run in Supabase SQL editor after every deployment. Any returned row is a failure.
with expected_relations(name) as (values
  ('profiles'), ('tshow_projects'), ('tshow_project_members'), ('tshow_invitations'),
  ('tshow_project_blocks'), ('tshow_project_document_versions'), ('tshow_plans'),
  ('tshow_subscriptions'), ('tshow_payment_attempts'), ('tshow_webhook_events'),
  ('tshow_upload_intents'), ('tshow_project_assets'), ('tshow_organizations'),
  ('tshow_organization_members'), ('tshow_project_approvals'),
  ('tshow_project_requirements'), ('tshow_incidents'), ('tshow_incident_actions'),
  ('tshow_guest_passes'), ('tshow_guest_sessions'), ('tshow_payment_transitions'),
  ('tshow_requirement_templates'), ('tshow_cleanup_jobs'), ('tshow_schema_versions')
), actual as (
  select table_name as name from information_schema.tables where table_schema = 'public'
)
select 'missing_table' as failure, e.name
from expected_relations e left join actual a using(name)
where a.name is null
union all
select 'missing_migration', '21'
where not exists(select 1 from public.tshow_schema_versions where version = 21)
union all
select 'missing_migration', '22'
where not exists(select 1 from public.tshow_schema_versions where version = 22)
union all
select 'project_without_organization', id::text
from public.tshow_projects where deleted_at is null and organization_id is null
union all
select 'project_without_document_snapshot', p.id::text
from public.tshow_projects p
where p.deleted_at is null and not exists (
  select 1 from public.tshow_project_document_versions v where v.project_id = p.id
);
