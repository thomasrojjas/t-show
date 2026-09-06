-- Offline synchronization and integration registry.
-- Secrets are never stored in these public records; secret_ref points to a
-- server-side secret manager/environment entry controlled by the API.

create table if not exists public.tshow_sync_operations (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  client_id text not null check (char_length(client_id) between 8 and 120),
  client_operation_id text not null check (char_length(client_operation_id) between 8 and 160),
  base_version bigint not null check (base_version >= 1),
  resulting_version bigint,
  operation_type text not null check (operation_type in ('replace_document','restore_version')),
  status text not null default 'accepted' check (status in ('accepted','conflict','rejected')),
  created_at timestamptz not null default now(),
  unique(actor_id, client_operation_id)
);
create index if not exists tshow_sync_project_idx on public.tshow_sync_operations(project_id, id);

create table if not exists public.tshow_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  operation_id bigint references public.tshow_sync_operations(id) on delete set null,
  base_version bigint not null,
  server_version bigint not null,
  client_snapshot jsonb not null,
  server_snapshot jsonb not null,
  status text not null default 'open' check (status in ('open','resolved','discarded')),
  resolution text check (resolution is null or resolution in ('server','client','manual')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tshow_sync_conflicts_project_idx on public.tshow_sync_conflicts(project_id, status, created_at desc);

create or replace function public.tshow_apply_sync_operation(
  target_project uuid,
  target_actor uuid,
  target_client text,
  target_operation text,
  target_base_version bigint,
  target_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_project public.tshow_projects%rowtype;
  previous_operation public.tshow_sync_operations%rowtype;
  created_operation public.tshow_sync_operations%rowtype;
  created_conflict public.tshow_sync_conflicts%rowtype;
begin
  select * into previous_operation from public.tshow_sync_operations
    where actor_id = target_actor and client_operation_id = target_operation;
  if found then
    return jsonb_build_object('status', previous_operation.status, 'idempotent', true, 'operationId', previous_operation.id, 'version', previous_operation.resulting_version);
  end if;

  select * into current_project from public.tshow_projects
    where id = target_project and deleted_at is null for update;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;

  if current_project.document_version <> target_base_version then
    insert into public.tshow_sync_operations(project_id, actor_id, client_id, client_operation_id, base_version, resulting_version, operation_type, status)
      values(target_project, target_actor, target_client, target_operation, target_base_version, current_project.document_version, 'replace_document', 'conflict')
      returning * into created_operation;
    insert into public.tshow_sync_conflicts(project_id, operation_id, base_version, server_version, client_snapshot, server_snapshot)
      values(target_project, created_operation.id, target_base_version, current_project.document_version, target_payload, current_project.payload)
      returning * into created_conflict;
    return jsonb_build_object('status', 'conflict', 'operationId', created_operation.id, 'conflictId', created_conflict.id, 'version', current_project.document_version);
  end if;

  update public.tshow_projects
    set payload = target_payload, event_name = coalesce(nullif(target_payload->>'eventName', ''), event_name)
    where id = target_project
    returning * into current_project;
  insert into public.tshow_sync_operations(project_id, actor_id, client_id, client_operation_id, base_version, resulting_version, operation_type, status)
    values(target_project, target_actor, target_client, target_operation, target_base_version, current_project.document_version, 'replace_document', 'accepted')
    returning * into created_operation;
  return jsonb_build_object('status', 'accepted', 'operationId', created_operation.id, 'version', current_project.document_version, 'updatedAt', current_project.updated_at);
end;
$$;
revoke all on function public.tshow_apply_sync_operation(uuid, uuid, text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.tshow_apply_sync_operation(uuid, uuid, text, text, bigint, jsonb) to service_role;

create table if not exists public.tshow_integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.tshow_organizations(id) on delete cascade,
  provider text not null check (provider in ('google_calendar','microsoft_calendar','slack','teams','zapier','make','n8n','accounting_export','local_bridge')),
  name text not null,
  status text not null default 'inactive' check (status in ('inactive','active','error','revoked')),
  secret_ref text,
  config jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, provider, name)
);
create index if not exists tshow_integrations_org_idx on public.tshow_integration_connections(organization_id, provider, status);

create table if not exists public.tshow_outbound_webhooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.tshow_organizations(id) on delete cascade,
  name text not null,
  endpoint_url text not null check (endpoint_url ~ '^https://'),
  signing_secret_ref text not null,
  events text[] not null default array[]::text[],
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.tshow_webhook_deliveries (
  id bigint generated always as identity primary key,
  webhook_id uuid not null references public.tshow_outbound_webhooks(id) on delete cascade,
  event_key text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivered','retrying','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(webhook_id, event_key)
);
create index if not exists tshow_webhook_delivery_queue_idx on public.tshow_webhook_deliveries(status, next_attempt_at) where status in ('pending','retrying');

drop trigger if exists tshow_integration_connections_updated on public.tshow_integration_connections;
create trigger tshow_integration_connections_updated before update on public.tshow_integration_connections for each row execute function public.tshow_set_updated_at();
drop trigger if exists tshow_outbound_webhooks_updated on public.tshow_outbound_webhooks;
create trigger tshow_outbound_webhooks_updated before update on public.tshow_outbound_webhooks for each row execute function public.tshow_set_updated_at();

alter table public.tshow_sync_operations enable row level security;
alter table public.tshow_sync_conflicts enable row level security;
alter table public.tshow_integration_connections enable row level security;
alter table public.tshow_outbound_webhooks enable row level security;
alter table public.tshow_webhook_deliveries enable row level security;
revoke all on public.tshow_sync_operations, public.tshow_sync_conflicts,
  public.tshow_integration_connections, public.tshow_outbound_webhooks,
  public.tshow_webhook_deliveries from anon, authenticated;
grant select on public.tshow_sync_operations, public.tshow_sync_conflicts,
  public.tshow_integration_connections, public.tshow_outbound_webhooks,
  public.tshow_webhook_deliveries to authenticated;

drop policy if exists tshow_sync_operations_read on public.tshow_sync_operations;
create policy tshow_sync_operations_read on public.tshow_sync_operations for select to authenticated using (private.tshow_can_access_project(project_id, 'read'));
drop policy if exists tshow_sync_conflicts_read on public.tshow_sync_conflicts;
create policy tshow_sync_conflicts_read on public.tshow_sync_conflicts for select to authenticated using (private.tshow_can_access_project(project_id, 'read'));
drop policy if exists tshow_integrations_read on public.tshow_integration_connections;
create policy tshow_integrations_read on public.tshow_integration_connections for select to authenticated using (private.tshow_can_access_organization(organization_id, 'read'));
drop policy if exists tshow_outbound_webhooks_read on public.tshow_outbound_webhooks;
create policy tshow_outbound_webhooks_read on public.tshow_outbound_webhooks for select to authenticated using (private.tshow_can_access_organization(organization_id, 'write'));
drop policy if exists tshow_webhook_deliveries_read on public.tshow_webhook_deliveries;
create policy tshow_webhook_deliveries_read on public.tshow_webhook_deliveries for select to authenticated using (
  exists (select 1 from public.tshow_outbound_webhooks w where w.id = webhook_id and private.tshow_can_access_organization(w.organization_id, 'write'))
);

do $$ begin alter publication supabase_realtime add table public.tshow_sync_operations; exception when duplicate_object then null; end $$;
