-- Read-only verification after migrations 014-016.
with payload_blocks as (
  select p.id, jsonb_array_length(coalesce(p.payload->'blocks', '[]'::jsonb)) as expected
  from public.tshow_projects p
  where p.deleted_at is null
), normalized_blocks as (
  select project_id as id, count(*)::integer as actual
  from public.tshow_project_blocks
  group by project_id
)
select p.id as project_id, p.expected, coalesce(n.actual, 0) as actual,
  p.expected = coalesce(n.actual, 0) as matches
from payload_blocks p
left join normalized_blocks n using (id)
order by p.id;

select
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.tshow_organizations) as organizations,
  (select count(*) from public.profiles where default_organization_id is null) as profiles_without_default_organization,
  (select count(*) from public.tshow_projects where deleted_at is null and organization_id is null) as active_projects_without_organization;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'tshow_project_blocks','tshow_project_document_versions','tshow_project_comments','tshow_project_assets',
    'tshow_clients','tshow_venues','tshow_suppliers','tshow_event_finances','tshow_expenses','tshow_quotes',
    'tshow_quote_items','tshow_contracts','tshow_tasks','tshow_calendar_events','tshow_sync_operations',
    'tshow_sync_conflicts','tshow_integration_connections','tshow_outbound_webhooks','tshow_webhook_deliveries'
  )
order by c.relname;
