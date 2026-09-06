-- Guarantee a recoverable baseline for projects that were materialized from
-- the legacy JSON document without an actual payload change.
insert into public.tshow_project_document_versions(project_id, version, snapshot, created_by, reason)
select p.id, p.document_version, p.payload, p.owner_id, 'normalized_baseline'
from public.tshow_projects p
where p.deleted_at is null
on conflict (project_id, version) do nothing;
