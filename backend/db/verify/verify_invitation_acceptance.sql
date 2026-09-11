-- Test-only identities and project; every change is rolled back. Run after the migration.
begin;
create temporary table qa_invite_context(uid uuid,pid uuid,hash text,email text) on commit drop;
insert into qa_invite_context values(gen_random_uuid(),gen_random_uuid(),'qa-'||gen_random_uuid(),'qa-'||gen_random_uuid()||'@example.invalid');
insert into auth.users(id,email,raw_user_meta_data)
select uid,email,'{"first_name":"Prueba","last_name":"Temporal","rut":"98765431-7","phone":"+56911111111"}'::jsonb from qa_invite_context;
insert into public.tshow_projects(id,owner_id,event_name) select pid,uid,'QA transaccional invitaciones' from qa_invite_context;
insert into public.tshow_invitations(project_id,email,role,token_hash,invited_by)
select pid,email,'editor',hash,uid from qa_invite_context;
do $$
declare c record; r record; audits integer;
begin
select * into c from qa_invite_context;
begin
 perform * from public.tshow_accept_invitation_service(c.hash,c.uid,'wrong@example.invalid');
 raise exception 'QA expected mismatch';
exception when others then if SQLERRM <> 'INVITATION_EMAIL_MISMATCH' then raise; end if; end;
begin
 perform * from public.tshow_accept_invitation_service(c.hash,gen_random_uuid(),c.email);
 raise exception 'QA expected missing profile';
exception when others then if SQLERRM <> 'PROFILE_NOT_FOUND' then raise; end if; end;
select * into r from public.tshow_accept_invitation_service(c.hash,c.uid,c.email);
if r.project_id <> c.pid or r.member_role <> 'editor' then raise exception 'QA acceptance'; end if;
select count(*) into audits from public.tshow_audit_log where project_id=c.pid and action='invitation.accepted';
perform * from public.tshow_accept_invitation_service(c.hash,c.uid,c.email);
if (select count(*) from public.tshow_audit_log where project_id=c.pid and action='invitation.accepted') <> audits then raise exception 'QA duplicated audit'; end if;
update public.tshow_project_members set role='viewer' where project_id=c.pid and user_id=c.uid;
select * into r from public.tshow_accept_invitation_service(c.hash,c.uid,c.email);
if r.member_role <> 'viewer' then raise exception 'QA retry changed role'; end if;
update public.tshow_invitations set status='pending',accepted_by=null where token_hash=c.hash;
select * into r from public.tshow_accept_invitation_service(c.hash,c.uid,c.email);
if r.member_role <> 'viewer' then raise exception 'QA pending changed role'; end if;
delete from public.tshow_project_members where project_id=c.pid and user_id=c.uid;
begin
 perform * from public.tshow_accept_invitation_service(c.hash,c.uid,c.email);
 raise exception 'QA expected removed';
exception when others then if SQLERRM <> 'INVITATION_ACCESS_REMOVED' then raise; end if; end;
update public.tshow_invitations set status='revoked' where token_hash=c.hash;
begin
 perform * from public.tshow_accept_invitation_service(c.hash,c.uid,c.email);
 raise exception 'QA expected revoked';
exception when others then if SQLERRM <> 'INVITATION_REVOKED' then raise; end if; end;
update public.tshow_invitations set status='pending',expires_at=now()-interval '1 hour' where token_hash=c.hash;
begin
 perform * from public.tshow_accept_invitation_service(c.hash,c.uid,c.email);
 raise exception 'QA expected expired';
exception when others then if SQLERRM <> 'INVITATION_EXPIRED' then raise; end if; end;
end $$;
select 'PASS: accept, retry, audit, role preservation, mismatch, profile, removal, revoked, expired' as result;
rollback;
