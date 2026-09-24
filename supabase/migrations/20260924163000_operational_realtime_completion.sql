-- Complete the operational realtime surface for tables already consumed by
-- the authenticated operational client. This is additive and contains no data
-- or permission changes.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tshow_technical_cues',
    'tshow_artist_appearances',
    'tshow_rehearsals'
  ] loop
    if to_regclass('public.' || table_name) is not null
       and not exists (
         select 1
         from pg_publication_rel pr
         join pg_publication p on p.oid = pr.prpubid
         join pg_class c on c.oid = pr.prrelid
         join pg_namespace n on n.oid = c.relnamespace
         where p.pubname = 'supabase_realtime'
           and n.nspname = 'public'
           and c.relname = table_name
       ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
