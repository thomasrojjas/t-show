-- Additive migration: legacy reads continue to work. Run before deploying the console.
alter table public.tshow_live_sessions add column if not exists revision bigint not null default 0;

create or replace function public.tshow_commit_live_session(
  target_project uuid, expected_revision bigint, next_state jsonb, actor uuid, action_name text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare current_revision bigint; result public.tshow_live_sessions;
begin
  perform pg_advisory_xact_lock(hashtextextended('tshow-live:' || target_project::text, 0));
  select revision into current_revision from public.tshow_live_sessions where project_id = target_project for update;
  if coalesce(current_revision, 0) <> expected_revision then
    raise exception using errcode = '40001', message = 'Live session conflict';
  end if;
  insert into public.tshow_live_sessions(project_id,state,updated_by,last_updated,revision)
    values(target_project,next_state,actor,now(),expected_revision + 1)
    on conflict(project_id) do update set state = excluded.state, updated_by = excluded.updated_by,
      last_updated = excluded.last_updated, revision = excluded.revision
    returning * into result;
  insert into public.tshow_audit_log(project_id,actor_id,action,metadata)
    values(target_project,actor,'live.' || action_name,jsonb_build_object('revision',result.revision));
  return jsonb_build_object('state',result.state,'revision',result.revision);
end;
$$;
revoke all on function public.tshow_commit_live_session(uuid,bigint,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.tshow_commit_live_session(uuid,bigint,jsonb,uuid,text) to service_role;
