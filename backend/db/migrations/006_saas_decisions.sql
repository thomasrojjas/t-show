-- SaaS decisions: atomic project quota and BaseAndes ownership bootstrap.
create or replace function public.tshow_enforce_project_quota()
returns trigger language plpgsql as $$
declare project_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('tshow-project-quota:' || new.owner_id::text, 0));
  select count(*) into project_count from public.tshow_projects
    where owner_id = new.owner_id and deleted_at is null;
  if project_count >= 10 then
    raise exception using errcode = 'check_violation', message = 'El propietario ya tiene el máximo de 10 proyectos activos.';
  end if;
  return new;
end;
$$;
drop trigger if exists tshow_project_quota on public.tshow_projects;
create trigger tshow_project_quota before insert on public.tshow_projects for each row execute function public.tshow_enforce_project_quota();
