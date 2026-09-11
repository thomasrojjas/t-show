-- Compatible replacement: preserve memberships, serialize retries, and avoid OUT-variable ambiguity.
create or replace function public.tshow_accept_invitation_service(
  invitation_hash text, authenticated_user uuid, authenticated_email text
) returns table(project_id uuid, member_role public.tshow_member_role)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  invitation public.tshow_invitations%rowtype;
  existing_role public.tshow_member_role;
begin
  select i.* into invitation from public.tshow_invitations i
  where i.token_hash = invitation_hash for update;
  if invitation.id is null then raise exception 'INVITATION_NOT_FOUND'; end if;
  if authenticated_email is null or btrim(authenticated_email) = '' or
    lower(btrim(invitation.email)) <> lower(btrim(authenticated_email)) then
    raise exception 'INVITATION_EMAIL_MISMATCH';
  end if;
  if not exists(select 1 from public.tshow_projects p where p.id=invitation.project_id and p.deleted_at is null) then
    raise exception 'INVITATION_NOT_FOUND';
  end if;
  if invitation.status = 'revoked' then raise exception 'INVITATION_REVOKED'; end if;
  select m.role into existing_role from public.tshow_project_members m
    where m.project_id=invitation.project_id and m.user_id=authenticated_user for update;
  if invitation.status = 'accepted' then
    if invitation.accepted_by is distinct from authenticated_user or existing_role is null then
      raise exception 'INVITATION_ACCESS_REMOVED';
    end if;
    return query select invitation.project_id, existing_role;
    return;
  end if;
  if invitation.status = 'expired' or invitation.expires_at <= now() then raise exception 'INVITATION_EXPIRED'; end if;
  if invitation.status <> 'pending' then raise exception 'INVITATION_NOT_PENDING'; end if;
  if not exists(select 1 from public.profiles p where p.id=authenticated_user) then raise exception 'PROFILE_NOT_FOUND'; end if;
  insert into public.tshow_project_members(project_id,user_id,role,invited_by)
    values(invitation.project_id,authenticated_user,invitation.role,invitation.invited_by)
    on conflict on constraint tshow_project_members_pkey do nothing;
  select m.role into existing_role from public.tshow_project_members m
    where m.project_id=invitation.project_id and m.user_id=authenticated_user for update;
  update public.tshow_invitations i set status='accepted',accepted_by=authenticated_user,accepted_at=now()
    where i.id=invitation.id;
  insert into public.tshow_audit_log(project_id,actor_id,action,metadata)
    values(invitation.project_id,authenticated_user,'invitation.accepted',jsonb_build_object('invitationId',invitation.id));
  return query select invitation.project_id,existing_role;
end;
$$;
revoke all on function public.tshow_accept_invitation_service(text,uuid,text) from public,anon,authenticated;
grant execute on function public.tshow_accept_invitation_service(text,uuid,text) to service_role;
