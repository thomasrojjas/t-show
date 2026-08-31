const crypto = require('crypto');
const express = require('express');
const { supabase } = require('../supabaseClient');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');

const router = express.Router();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const enums = {
  approval: new Set(['draft','review','approved','running','closed']),
  incidentType: new Set(['security','medical','technical','electrical','supplier','weather','crowd','access','transport','other']),
  priority: new Set(['low','medium','high','critical']),
  incidentStatus: new Set(['open','attending','resolved','closed']),
  requirementStatus: new Set(['pending','uploaded','approved','rejected'])
};
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

async function projectAccess(req, projectId, edit = false) {
  const { data: project } = await supabase.from('tshow_projects').select('*').eq('id', projectId).is('deleted_at', null).maybeSingle();
  if (!project) return null;
  if (req.user.profile?.role === 'platform_admin' || project.owner_id === req.user.id) return { project, role: project.owner_id === req.user.id ? 'owner' : 'admin' };
  const { data: member } = await supabase.from('tshow_project_members').select('role').eq('project_id', projectId).eq('user_id', req.user.id).maybeSingle();
  if (!member || (edit && member.role !== 'editor')) return null;
  return { project, role: member.role };
}
const canManage = access => access && ['owner','admin'].includes(access.role);
const canEdit = access => access && ['owner','admin','editor'].includes(access.role);
const fail = (res, code, message) => res.status(code).json({ success: false, message });

router.get('/organizations', requireSupabaseAuth, async (req, res) => {
  if (req.user.profile?.role === 'platform_admin') {
    const { data, error } = await supabase.from('tshow_organizations').select('*').order('name');
    return error ? fail(res, 500, error.message) : res.json({ success: true, data: data || [] });
  }
  const { data, error } = await supabase.from('tshow_organization_members').select('role,tshow_organizations(*)').eq('user_id', req.user.id);
  if (error) return fail(res, 500, error.message);
  res.json({ success: true, data: (data || []).map(row => ({ ...row.tshow_organizations, role: row.role })) });
});
async function orgAccess(req, id) {
  if (req.user.profile?.role === 'platform_admin') return true;
  const { data } = await supabase.from('tshow_organization_members').select('role').eq('organization_id', id).eq('user_id', req.user.id).maybeSingle();
  return Boolean(data);
}
router.get('/organizations/:id/events', requireSupabaseAuth, async (req, res) => {
  if (!await orgAccess(req, req.params.id)) return fail(res, 403, 'No tienes acceso a esta organización.');
  const { data, error } = await supabase.from('tshow_projects').select('id,event_name,payload,owner_id,updated_at').eq('organization_id', req.params.id).is('deleted_at', null).order('updated_at', { ascending: false });
  if (error) return fail(res, 500, error.message); res.json({ success: true, data: data || [] });
});
router.get('/organizations/:id/calendar', requireSupabaseAuth, async (req, res) => {
  if (!await orgAccess(req, req.params.id)) return fail(res, 403, 'No tienes acceso a esta organización.');
  const { data, error } = await supabase.from('tshow_projects').select('id,event_name,payload').eq('organization_id', req.params.id).is('deleted_at', null);
  if (error) return fail(res, 500, error.message);
  res.json({ success: true, data: (data || []).map(p => ({ id: p.id, title: p.event_name, date: p.payload?.eventDate || null, location: p.payload?.location || '' })) });
});
router.get('/organizations/:id/metrics', requireSupabaseAuth, async (req, res) => {
  if (!await orgAccess(req, req.params.id)) return fail(res, 403, 'No tienes acceso a esta organización.');
  const { data: projects, error } = await supabase.from('tshow_projects').select('id').eq('organization_id', req.params.id).is('deleted_at', null);
  if (error) return fail(res, 500, error.message);
  const ids = (projects || []).map(p => p.id); const [{ data: approvals }, { data: incidents }, { data: requirements }] = await Promise.all([
    ids.length ? supabase.from('tshow_project_approvals').select('status').in('project_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from('tshow_incidents').select('priority,status').in('project_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from('tshow_project_requirements').select('status').in('project_id', ids) : Promise.resolve({ data: [] })
  ]);
  const count = status => (approvals || []).filter(item => item.status === status).length;
  res.json({ success: true, data: { total: ids.length, preparation: count('draft') + count('review'), approved: count('approved'), running: count('running'), incidents: (incidents || []).filter(i => i.status !== 'closed').length, criticalIncidents: (incidents || []).filter(i => i.priority === 'critical' && i.status !== 'closed').length, pendingDocuments: (requirements || []).filter(r => r.status !== 'approved').length } });
});

router.get('/projects/:id/approval', requireSupabaseAuth, async (req, res) => {
  const access = await projectAccess(req, req.params.id); if (!access) return fail(res, 403, 'No tienes acceso a este evento.');
  const [{ data: approval }, { data: history }, { data: requirements }] = await Promise.all([
    supabase.from('tshow_project_approvals').select('*').eq('project_id', req.params.id).maybeSingle(),
    supabase.from('tshow_project_approval_history').select('*').eq('project_id', req.params.id).order('created_at', { ascending: false }),
    supabase.from('tshow_project_requirements').select('*').eq('project_id', req.params.id).order('due_at')
  ]);
  res.json({ success: true, data: { approval: approval || { project_id: req.params.id, status: 'draft' }, history: history || [], requirements: requirements || [] } });
});
router.patch('/projects/:id/approval/status', requireSupabaseAuth, async (req, res) => {
  const access = await projectAccess(req, req.params.id); if (!canManage(access)) return fail(res, 403, 'Solo el propietario o administrador puede aprobar.');
  const status = clean(req.body.status, 20); if (!enums.approval.has(status)) return fail(res, 400, 'Estado de aprobación inválido.');
  const { data: current } = await supabase.from('tshow_project_approvals').select('status').eq('project_id', req.params.id).maybeSingle(); const previous = current?.status || 'draft';
  const { data, error } = await supabase.from('tshow_project_approvals').upsert({ project_id: req.params.id, status, comment: clean(req.body.comment, 1000), updated_by: req.user.id }).select().single();
  if (error) return fail(res, 400, error.message);
  await supabase.from('tshow_project_approval_history').insert({ project_id: req.params.id, actor_id: req.user.id, previous_status: previous, new_status: status, comment: clean(req.body.comment, 1000) });
  res.json({ success: true, data });
});
router.get('/projects/:id/requirements', requireSupabaseAuth, async (req, res) => { const a = await projectAccess(req, req.params.id); if (!a) return fail(res,403,'No tienes acceso a este evento.'); const { data,error }=await supabase.from('tshow_project_requirements').select('*').eq('project_id',req.params.id).order('due_at'); if(error)return fail(res,500,error.message); res.json({success:true,data:data||[]}); });
router.post('/projects/:id/requirements', requireSupabaseAuth, async (req,res)=>{const a=await projectAccess(req,req.params.id,true);if(!canEdit(a))return fail(res,403,'No tienes permisos para crear requisitos.');const name=clean(req.body.name,180);if(name.length<2)return fail(res,400,'El nombre del requisito es obligatorio.');const {data,error}=await supabase.from('tshow_project_requirements').insert({project_id:req.params.id,name,type:clean(req.body.type,40)||'other',assigned_to:req.body.assignedTo||null,due_at:req.body.dueAt||null,created_by:req.user.id}).select().single();if(error)return fail(res,400,error.message);res.status(201).json({success:true,data});});
router.patch('/projects/:id/requirements/:requirementId', requireSupabaseAuth, async(req,res)=>{const a=await projectAccess(req,req.params.id,true);if(!canEdit(a))return fail(res,403,'No tienes permisos para editar requisitos.');const patch={};if(req.body.name!==undefined)patch.name=clean(req.body.name,180);if(req.body.status!==undefined&&enums.requirementStatus.has(req.body.status))patch.status=req.body.status;if(req.body.comment!==undefined)patch.comment=clean(req.body.comment,1000);if(req.body.fileKey!==undefined)patch.file_key=clean(req.body.fileKey,500);const {data,error}=await supabase.from('tshow_project_requirements').update(patch).eq('id',req.params.requirementId).eq('project_id',req.params.id).select().single();if(error)return fail(res,400,error.message);res.json({success:true,data});});
router.post('/projects/:id/requirements/:requirementId/review', requireSupabaseAuth, async(req,res)=>{const a=await projectAccess(req,req.params.id);if(!canManage(a))return fail(res,403,'Solo el propietario o administrador puede revisar documentos.');const status=req.body.status;if(!['approved','rejected'].includes(status))return fail(res,400,'Revisión inválida.');const {data,error}=await supabase.from('tshow_project_requirements').update({status,comment:clean(req.body.comment,1000)}).eq('id',req.params.requirementId).eq('project_id',req.params.id).select().single();if(error)return fail(res,400,error.message);res.json({success:true,data});});

router.get('/projects/:id/incidents', requireSupabaseAuth, async(req,res)=>{const a=await projectAccess(req,req.params.id);if(!a)return fail(res,403,'No tienes acceso a este evento.');const {data,error}=await supabase.from('tshow_incidents').select('*,tshow_incident_actions(*)').eq('project_id',req.params.id).order('created_at',{ascending:false});if(error)return fail(res,500,error.message);res.json({success:true,data:data||[]});});
router.post('/projects/:id/incidents', requireSupabaseAuth, async(req,res)=>{const a=await projectAccess(req,req.params.id,true);if(!canEdit(a))return fail(res,403,'No tienes permisos para registrar incidentes.');const title=clean(req.body.title,180);if(title.length<2)return fail(res,400,'El título es obligatorio.');const type=enums.incidentType.has(req.body.type)?req.body.type:'other';const priority=enums.priority.has(req.body.priority)?req.body.priority:'medium';const {data,error}=await supabase.from('tshow_incidents').insert({project_id:req.params.id,title,description:clean(req.body.description,4000),type,priority,location:clean(req.body.location,180),block_id:clean(req.body.blockId,120)||null,assigned_to:req.body.assignedTo||null,created_by:req.user.id}).select().single();if(error)return fail(res,400,error.message);res.status(201).json({success:true,data});});
router.patch('/projects/:id/incidents/:incidentId', requireSupabaseAuth, async(req,res)=>{const a=await projectAccess(req,req.params.id,true);if(!canEdit(a))return fail(res,403,'No tienes permisos para actualizar incidentes.');const patch={};for(const key of ['title','description','location'])if(req.body[key]!==undefined)patch[key]=clean(req.body[key],key==='description'?4000:180);if(req.body.priority&&enums.priority.has(req.body.priority))patch.priority=req.body.priority;if(req.body.status&&enums.incidentStatus.has(req.body.status))patch.status=req.body.status;if(req.body.assignedTo!==undefined)patch.assigned_to=req.body.assignedTo||null;const {data,error}=await supabase.from('tshow_incidents').update(patch).eq('id',req.params.incidentId).eq('project_id',req.params.id).select().single();if(error)return fail(res,400,error.message);res.json({success:true,data});});
router.post('/projects/:id/incidents/:incidentId/actions', requireSupabaseAuth, async(req,res)=>{const a=await projectAccess(req,req.params.id,true);if(!canEdit(a))return fail(res,403,'No tienes permisos para agregar acciones.');const body=clean(req.body.body,2000);if(!body)return fail(res,400,'La acción no puede estar vacía.');const {data,error}=await supabase.from('tshow_incident_actions').insert({incident_id:req.params.incidentId,actor_id:req.user.id,body}).select().single();if(error)return fail(res,400,error.message);res.status(201).json({success:true,data});});
router.post('/projects/:id/incidents/:incidentId/close', requireSupabaseAuth, async(req,res)=>{const a=await projectAccess(req,req.params.id,true);if(!canEdit(a))return fail(res,403,'No tienes permisos para cerrar incidentes.');const {data,error}=await supabase.from('tshow_incidents').update({status:'closed',resolved_by:req.user.id,resolved_at:new Date().toISOString()}).eq('id',req.params.incidentId).eq('project_id',req.params.id).select().single();if(error)return fail(res,400,error.message);res.json({success:true,data});});

router.post('/projects/:id/guest-passes', requireSupabaseAuth, async(req,res)=>{const a=await projectAccess(req,req.params.id);if(!canManage(a))return fail(res,403,'Solo el propietario o administrador puede crear accesos.');const token=crypto.randomBytes(32).toString('hex');const days=Math.min(Math.max(Number(req.body.days)||7,1),30);const {data,error}=await supabase.from('tshow_guest_passes').insert({project_id:req.params.id,token_hash:hash(token),label:clean(req.body.label,120)||null,include_script:Boolean(req.body.includeScript),expires_at:new Date(Date.now()+days*86400000).toISOString(),created_by:req.user.id}).select('id,project_id,label,include_script,expires_at,created_at').single();if(error)return fail(res,400,error.message);res.status(201).json({success:true,data,url:`${process.env.FRONTEND_URL||''}/guest.html?token=${token}`});});
router.get('/projects/:id/guest-passes', requireSupabaseAuth, async(req,res)=>{const a=await projectAccess(req,req.params.id);if(!canManage(a))return fail(res,403,'No tienes permisos para ver accesos.');const {data,error}=await supabase.from('tshow_guest_passes').select('id,project_id,label,include_script,expires_at,revoked_at,created_at,last_accessed_at,access_count').eq('project_id',req.params.id).order('created_at',{ascending:false});if(error)return fail(res,500,error.message);res.json({success:true,data:data||[]});});
router.delete('/projects/:id/guest-passes/:passId', requireSupabaseAuth, async(req,res)=>{const a=await projectAccess(req,req.params.id);if(!canManage(a))return fail(res,403,'No tienes permisos para revocar accesos.');const {error}=await supabase.from('tshow_guest_passes').update({revoked_at:new Date().toISOString()}).eq('id',req.params.passId).eq('project_id',req.params.id);if(error)return fail(res,400,error.message);res.json({success:true});});
router.get('/guest-passes/:token', async(req,res)=>{const token=String(req.params.token||'');if(!/^[a-f0-9]{64}$/i.test(token))return fail(res,404,'El acceso no es válido.');const {data:pass}=await supabase.from('tshow_guest_passes').select('id,project_id,include_script,expires_at,revoked_at').eq('token_hash',hash(token)).maybeSingle();if(!pass||pass.revoked_at||new Date(pass.expires_at)<=new Date())return fail(res,410,'Este acceso venció o fue revocado.');const {data:project}=await supabase.from('tshow_projects').select('id,event_name,payload,updated_at').eq('id',pass.project_id).is('deleted_at',null).maybeSingle();if(!project)return fail(res,404,'El evento ya no está disponible.');const blocks=Array.isArray(project.payload?.blocks)?project.payload.blocks:[];await supabase.from('tshow_guest_passes').update({last_accessed_at:new Date().toISOString(),access_count:((pass.access_count||0)+1)}).eq('id',pass.id);res.json({success:true,data:{projectId:project.id,eventName:project.event_name,eventDate:project.payload?.eventDate||null,location:project.payload?.location||'',updatedAt:project.updated_at,blocks:blocks.map(b=>({type:b.type,title:b.title,start:b.start,duration:b.duration,end:b.end,notes:pass.include_script?b.notes:'',animator_script:pass.include_script?b.animator_script:''}))}});});

module.exports = router;
