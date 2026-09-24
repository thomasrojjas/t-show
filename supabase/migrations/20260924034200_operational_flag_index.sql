create index if not exists tshow_operational_flags_enabled_by_idx
  on public.tshow_operational_feature_flags(enabled_by);
