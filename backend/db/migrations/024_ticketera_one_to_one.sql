-- Enforce a strict one-to-one relationship between T-Show projects and Ticketera events.
-- Safe to execute after migration 023. Existing duplicates must be resolved first.

insert into public.tshow_schema_versions(version, name)
values (24, 'ticketera_one_to_one')
on conflict (version) do update set name = excluded.name;

create unique index if not exists tshow_ticketera_connections_external_event_unique_idx
  on public.tshow_ticketera_connections(external_event_id);

