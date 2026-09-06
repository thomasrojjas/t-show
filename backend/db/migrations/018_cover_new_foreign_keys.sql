-- Cover every foreign key introduced by migrations 014-016.
-- Besides improving joins, these indexes avoid full-table scans when a referenced
-- profile, organization, block, client, supplier, or operation is updated/deleted.

create index if not exists tshow_clients_created_by_idx
  on public.tshow_clients(created_by);

create index if not exists tshow_venues_created_by_idx
  on public.tshow_venues(created_by);

create index if not exists tshow_suppliers_created_by_idx
  on public.tshow_suppliers(created_by);

create index if not exists tshow_event_finances_updated_by_idx
  on public.tshow_event_finances(updated_by);

create index if not exists tshow_expenses_supplier_idx
  on public.tshow_expenses(supplier_id);

create index if not exists tshow_expenses_created_by_idx
  on public.tshow_expenses(created_by);

create index if not exists tshow_quotes_client_idx
  on public.tshow_quotes(client_id);

create index if not exists tshow_quotes_created_by_idx
  on public.tshow_quotes(created_by);

create index if not exists tshow_contracts_client_idx
  on public.tshow_contracts(client_id);

create index if not exists tshow_contracts_created_by_idx
  on public.tshow_contracts(created_by);

create index if not exists tshow_tasks_assigned_to_idx
  on public.tshow_tasks(assigned_to);

create index if not exists tshow_tasks_created_by_idx
  on public.tshow_tasks(created_by);

create index if not exists tshow_project_assets_block_idx
  on public.tshow_project_assets(block_id);

create index if not exists tshow_project_assets_uploaded_by_idx
  on public.tshow_project_assets(uploaded_by);

create index if not exists tshow_document_versions_created_by_idx
  on public.tshow_project_document_versions(created_by);

create index if not exists tshow_sync_conflicts_operation_idx
  on public.tshow_sync_conflicts(operation_id);

create index if not exists tshow_sync_conflicts_resolved_by_idx
  on public.tshow_sync_conflicts(resolved_by);

create index if not exists tshow_outbound_webhooks_organization_idx
  on public.tshow_outbound_webhooks(organization_id);

create index if not exists tshow_outbound_webhooks_created_by_idx
  on public.tshow_outbound_webhooks(created_by);
