do $$ begin
  alter publication supabase_realtime add table public.tshow_technical_cues;
  alter publication supabase_realtime add table public.tshow_tasks;
  alter publication supabase_realtime add table public.tshow_artists;
  alter publication supabase_realtime add table public.tshow_artist_appearances;
  alter publication supabase_realtime add table public.tshow_rehearsals;
exception when duplicate_object then null; end $$;

create index if not exists tshow_tasks_template_idx
  on public.tshow_tasks(project_id,task_kind,title);
