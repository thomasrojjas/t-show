-- Internal event chat. Additive migration: observers and existing projects remain unchanged.
create table if not exists public.tshow_chat_event_sequences (
  project_id uuid primary key references public.tshow_projects(id) on delete cascade,
  next_sequence bigint not null default 1 check (next_sequence > 0)
);

create table if not exists public.tshow_chat_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  sender_id uuid not null references public.profiles(id) on delete restrict,
  sender_name text not null check (char_length(trim(sender_name)) between 1 and 180),
  body text not null check (char_length(body) between 1 and 2000),
  block_key text,
  block_number integer check (block_number is null or block_number > 0),
  block_title text,
  client_message_id uuid not null,
  created_at timestamptz not null default now(),
  unique (project_id, sequence),
  unique (sender_id, client_message_id)
);

create index if not exists tshow_chat_messages_project_sequence_idx
  on public.tshow_chat_messages(project_id, sequence desc);
create index if not exists tshow_chat_messages_sender_client_idx
  on public.tshow_chat_messages(sender_id, client_message_id);

create table if not exists public.tshow_chat_reads (
  project_id uuid not null references public.tshow_projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_sequence bigint not null default 0 check (last_read_sequence >= 0),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists tshow_chat_reads_user_idx
  on public.tshow_chat_reads(user_id, project_id);

create table if not exists public.tshow_chat_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  sound_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Sequence allocation is only callable by the backend service role. The API
-- authorizes the project member before invoking it, and the row update is
-- atomic so concurrent messages in one event receive distinct cursors.
create or replace function public.tshow_chat_next_sequence(target_project uuid)
returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare allocated bigint;
begin
  insert into public.tshow_chat_event_sequences(project_id, next_sequence)
  values (target_project, 1)
  on conflict (project_id) do nothing;

  update public.tshow_chat_event_sequences
    set next_sequence = next_sequence + 1
    where project_id = target_project
    returning next_sequence - 1 into allocated;

  return allocated;
end;
$$;

alter table public.tshow_chat_event_sequences enable row level security;
alter table public.tshow_chat_messages enable row level security;
alter table public.tshow_chat_reads enable row level security;
alter table public.tshow_chat_preferences enable row level security;

drop policy if exists chat_messages_member_read on public.tshow_chat_messages;
create policy chat_messages_member_read on public.tshow_chat_messages
  for select to authenticated
  using (public.tshow_is_project_member(project_id));

drop policy if exists chat_reads_self_read on public.tshow_chat_reads;
create policy chat_reads_self_read on public.tshow_chat_reads
  for select to authenticated
  using (user_id = (select auth.uid()) and public.tshow_is_project_member(project_id));

drop policy if exists chat_reads_self_write on public.tshow_chat_reads;
create policy chat_reads_self_write on public.tshow_chat_reads
  for all to authenticated
  using (user_id = (select auth.uid()) and public.tshow_is_project_member(project_id))
  with check (user_id = (select auth.uid()) and public.tshow_is_project_member(project_id));

drop policy if exists chat_preferences_self_read on public.tshow_chat_preferences;
create policy chat_preferences_self_read on public.tshow_chat_preferences
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists chat_preferences_self_write on public.tshow_chat_preferences;
create policy chat_preferences_self_write on public.tshow_chat_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.tshow_chat_event_sequences from anon, authenticated;
revoke all on public.tshow_chat_messages from anon, authenticated;
revoke all on public.tshow_chat_reads from anon, authenticated;
revoke all on public.tshow_chat_preferences from anon, authenticated;
grant select on public.tshow_chat_messages to authenticated;
grant select, insert, update on public.tshow_chat_reads to authenticated;
grant select, insert, update on public.tshow_chat_preferences to authenticated;
revoke all on function public.tshow_chat_next_sequence(uuid) from public, anon, authenticated;
grant execute on function public.tshow_chat_next_sequence(uuid) to service_role;

do $$ begin
  alter publication supabase_realtime add table public.tshow_chat_messages;
exception when duplicate_object then null;
end $$;
