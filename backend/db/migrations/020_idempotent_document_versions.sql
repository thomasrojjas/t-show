-- Prevent legacy or retried updates from failing when a snapshot already exists.
create or replace function public.tshow_version_project_document()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.payload is distinct from old.payload then
    insert into public.tshow_project_document_versions
      (project_id, version, snapshot, created_by, reason)
    values
      (
        old.id,
        old.document_version,
        old.payload,
        case
          when coalesce(current_setting('request.jwt.claim.sub', true), '')
            ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          then current_setting('request.jwt.claim.sub', true)::uuid
          else null
        end,
        'automatic'
      )
    on conflict (project_id, version) do nothing;
    new.document_version := old.document_version + 1;
  end if;
  return new;
end;
$$;
