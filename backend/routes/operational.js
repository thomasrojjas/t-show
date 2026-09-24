const express = require('express');
const { supabase } = require('../supabaseClient');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');

const router = express.Router();
const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const fail = (res, status, message, code = 'operational_error') => res.status(status).json({ success: false, code, message });
const enabled = () => process.env.TSHOW_OPERATIONAL_FEATURES === 'true' || process.env.NODE_ENV !== 'production';
async function featureEnabled(req) { if (enabled()) return true; if (!uuid(req.params.id)) return false; const { data } = await supabase.from('tshow_operational_feature_flags').select('enabled').eq('project_id', req.params.id).maybeSingle(); return data?.enabled === true; }
const guard = async (req, res, next) => { try { if (await featureEnabled(req)) return next(); return fail(res, 503, 'Las funciones operativas están temporalmente desactivadas para este evento.', 'feature_disabled'); } catch (_) { return fail(res, 503, 'No se pudo verificar la habilitación operativa.', 'service_unavailable'); } };

// Area operators may update their assigned checklist without gaining access
// to the schedule editor. Owners and editors continue through the canonical
// route below, so this middleware only handles the narrower delegated case.
router.use('/projects/:id/tasks/:taskId', async (req,res,next)=>{
  if(req.method!=='PATCH')return next();
  if(!req.user?.id)return next();
  try{
    if(!(await featureEnabled(req)))return fail(res,503,'Las funciones operativas están temporalmente desactivadas para este evento.','feature_disabled');
    const a=await access(req,req.params.id); if(!a)return next();
    const {data:previous}=await supabase.from('tshow_tasks').select('*').eq('id',req.params.taskId).eq('project_id',req.params.id).maybeSingle();
    if(!previous||!uuid(previous.area_id))return next();
    const {data:assignment}=await supabase.from('tshow_project_area_members').select('can_update').eq('area_id',previous.area_id).eq('user_id',req.user.id).maybeSingle();
    if(!assignment?.can_update)return next();
    const nextStatus=req.body.status&&['pending','in_progress','blocked','completed','cancelled','not_applicable'].includes(req.body.status)?req.body.status:previous.status;
    const notApplicableReason=req.body.notApplicableReason===undefined?previous.not_applicable_reason:clean(req.body.notApplicableReason,1000);
    if(nextStatus==='not_applicable'&&!notApplicableReason)return fail(res,400,'Indica por qué la tarea no aplica.','validation_error');
    const patch={status:nextStatus,last_changed_by:req.user.id,updated_at:new Date().toISOString()};
    if(req.body.blockedReason!==undefined)patch.blocked_reason=clean(req.body.blockedReason,1000);
    if(req.body.notApplicableReason!==undefined)patch.not_applicable_reason=notApplicableReason;
    const {data,error}=await supabase.from('tshow_tasks').update(patch).eq('id',previous.id).eq('project_id',req.params.id).select().single();
    if(error)return fail(res,400,'No se pudo actualizar la tarea.','validation_error');
    if(previous.status!==data.status)await supabase.from('tshow_task_events').insert({task_id:data.id,project_id:req.params.id,actor_id:req.user.id,from_status:previous.status,to_status:data.status,note:clean(req.body.note,2000)});
    return res.json({success:true,data});
  }catch(error){return next(error);}
});

async function access(req, projectId, write = false) {
  if (!uuid(projectId)) return null;
  const { data: project } = await supabase.from('tshow_projects').select('id,owner_id,organization_id,document_version,payload').eq('id', projectId).is('deleted_at', null).maybeSingle();
  if (!project) return null;
  if (project.owner_id === req.user.id) return { project, role: 'owner' };
  const { data: member } = await supabase.from('tshow_project_members').select('role').eq('project_id', projectId).eq('user_id', req.user.id).maybeSingle();
  if (member) return (!write || member.role === 'editor') ? { project, role: member.role } : null;
  if (project.organization_id) {
    const { data: org } = await supabase.from('tshow_organization_members').select('role').eq('organization_id', project.organization_id).eq('user_id', req.user.id).maybeSingle();
    if (org && (!write || ['owner','admin'].includes(org.role))) return { project, role: org.role };
  }
  return null;
}
const canManage = a => a && ['owner','admin'].includes(a.role);
const canWrite = a => a && ['owner','admin','editor'].includes(a.role);
async function areaOperator(req, projectId, areaId) {
  const a = await access(req, projectId);
  if (!a) return null;
  if (canWrite(a)) return a;
  if (!uuid(areaId)) return null;
  const { data: assignment } = await supabase.from('tshow_project_area_members').select('can_update').eq('area_id', areaId).eq('user_id', req.user.id).maybeSingle();
  return assignment?.can_update ? a : null;
}
const audit = (projectId, actorId, action, metadata = {}) => supabase.from('tshow_audit_log').insert({ project_id: projectId, actor_id: actorId, action, metadata });

// Delegated area operators may maintain their own technical cues without
// receiving schedule-edit permissions. Owners/editors continue through the
// canonical route below.
router.use('/projects/:id/technical-cues', requireSupabaseAuth, guard, async (req, res, next) => {
  if (req.method !== 'POST' || !req.user?.id || !uuid(req.body?.areaId)) return next();
  try {
    const a = await areaOperator(req, req.params.id, req.body.areaId);
    if (!a || canWrite(a)) return next();
    const patch = { project_id: req.params.id, block_id: uuid(req.body.blockId) ? req.body.blockId : null, area_id: req.body.areaId, body: clean(req.body.body, 4000), updated_by: req.user.id };
    const { data, error } = await supabase.from('tshow_technical_cues').upsert(patch, { onConflict: 'project_id,block_id,area_id' }).select().single();
    if (error) return fail(res, 400, 'No se pudo guardar la indicación.', 'validation_error');
    await audit(req.params.id, req.user.id, 'operational.cue.updated', { cueId: data.id });
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
});

// Keep an append-only state history for artist appearances. The current row
// remains the fast operational projection; this middleware records each
// accepted transition before returning the compatible appearance response.
router.use('/projects/:id/appearances/:appearanceId', requireSupabaseAuth, guard, async (req, res, next) => {
  if (req.method !== 'PATCH') return next();
  try {
    const a = await access(req, req.params.id);
    let allowed = canWrite(a);
    if (!allowed && a) {
      const { data: dressing } = await supabase.from('tshow_project_areas').select('id').eq('project_id', req.params.id).eq('area_key', 'dressing').eq('status', 'active').maybeSingle();
      if (dressing) allowed = Boolean((await supabase.from('tshow_project_area_members').select('can_update').eq('area_id', dressing.id).eq('user_id', req.user.id).maybeSingle()).data?.can_update);
    }
    if (!a || !allowed) return fail(res, 403, 'No tienes permisos para actualizar la presentación.', 'forbidden');
    const { data: previous, error: readError } = await supabase.from('tshow_artist_appearances').select('*').eq('id', req.params.appearanceId).eq('project_id', req.params.id).maybeSingle();
    if (readError) return fail(res, 503, 'No se pudo leer la presentación.', 'service_unavailable');
    if (!previous) return fail(res, 404, 'Presentación no encontrada.', 'not_found');
    const nextStatus = req.body.status && ['expected','on_site','in_dressing_room','ready','finished'].includes(req.body.status) ? req.body.status : previous.status;
    const patch = { updated_by: req.user.id, updated_at: new Date().toISOString(), status: nextStatus };
    if (req.body.dressingRoom !== undefined) patch.dressing_room = clean(req.body.dressingRoom, 100);
    const { data, error } = await supabase.from('tshow_artist_appearances').update(patch).eq('id', previous.id).eq('project_id', req.params.id).select().single();
    if (error) return fail(res, 400, 'No se pudo actualizar el estado del artista.', 'validation_error');
    if (previous.status !== data.status) {
      const { error: historyError } = await supabase.from('tshow_artist_appearance_events').insert({ appearance_id: data.id, project_id: req.params.id, from_status: previous.status, to_status: data.status, changed_by: req.user.id, note: clean(req.body.note, 2000) });
      if (historyError) return fail(res, 503, 'El estado se actualizó, pero no se pudo registrar su historial.', 'partial_failure');
    }
    await audit(req.params.id, req.user.id, 'operational.appearance.updated', { appearanceId: data.id, fromStatus: previous.status, toStatus: data.status });
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
});

router.get('/projects/:id/appearances/:appearanceId/history', requireSupabaseAuth, guard, async (req, res) => {
  const a = await access(req, req.params.id);
  if (!a) return fail(res, 403, 'No tienes acceso a este evento.', 'forbidden');
  const { data, error } = await supabase.from('tshow_artist_appearance_events').select('id,appearance_id,from_status,to_status,changed_by,note,changed_at').eq('project_id', req.params.id).eq('appearance_id', req.params.appearanceId).order('changed_at', { ascending: false }).limit(100);
  if (error) return fail(res, 500, 'No se pudo cargar el historial del artista.', 'service_unavailable');
  res.json({ success: true, data: data || [] });
});

router.patch('/projects/:id/rehearsals/:rehearsalId', requireSupabaseAuth, guard, async(req,res,next)=>{
  const a=await access(req.params.id,true); if(!canManage(a))return next();
  const {data:rehearsal,error:readError}=await supabase.from('tshow_rehearsals').select('*').eq('id',req.params.rehearsalId).eq('project_id',req.params.id).maybeSingle();
  if(readError)return fail(res,500,'No se pudo leer el ensayo.','service_unavailable'); if(!rehearsal)return fail(res,404,'El ensayo no existe.','not_found');
  const action=String(req.body.action||'status'); const blocks=Array.isArray(rehearsal.snapshot?.blocks)?rehearsal.snapshot.blocks:[]; const patch={updated_at:new Date().toISOString()};
  if(action==='start')patch.status='running';
  else if(action==='pause')patch.status='paused';
  else if(action==='finish')patch.status='finished';
  else if(action==='reset'){patch.status='draft';patch.current_index=0;patch.elapsed_seconds=0;patch.simulated_now=null;}
  else if(action==='next')patch.current_index=Math.min(Math.max(0,blocks.length-1),Number(rehearsal.current_index||0)+1);
  else if(action==='previous')patch.current_index=Math.max(0,Number(rehearsal.current_index||0)-1);
  else if(action==='seek'){const timestamp=Date.parse(req.body.simulatedNow||'');if(!Number.isFinite(timestamp))return fail(res,400,'El instante simulado no es válido.','validation_error');patch.simulated_now=new Date(timestamp).toISOString();}
  else if(action==='status'&&['draft','running','paused','finished','cancelled'].includes(req.body.status))patch.status=req.body.status;
  else return fail(res,400,'Acción de ensayo inválida.','validation_error');
  const {data,error}=await supabase.from('tshow_rehearsals').update(patch).eq('id',rehearsal.id).eq('updated_at',rehearsal.updated_at).select().single();
  if(error||!data)return fail(res,409,'El ensayo cambió en otra sesión. Actualiza e inténtalo nuevamente.','conflict');
  await audit(req.params.id,req.user.id,'operational.rehearsal.controlled',{rehearsalId:rehearsal.id,action,currentIndex:data.current_index,status:data.status}); res.json({success:true,data});
});

router.post('/projects/:id/timing-adjustments/preview', requireSupabaseAuth, guard, async (req,res)=>{
  const a=await access(req,req.params.id,true); if(!canWrite(a))return fail(res,403,'No tienes permisos para proponer ajustes.','forbidden');
  const input=Array.isArray(req.body.blocks)?req.body.blocks:[];
  if(!input.length)return fail(res,400,'Debes incluir bloques para simular.','validation_error');
  const blocks=[];
  for(const [index,b] of input.entries()){
    const original=Number(b.originalMinutes), proposed=Number(b.proposedMinutes), minimum=Math.max(1,Number(b.minimumMinutes)||1), fixed=Boolean(b.fixed);
    if(!Number.isFinite(original)||original<minimum||!Number.isFinite(proposed)||proposed<minimum)return fail(res,400,'Las duraciones y mínimos deben ser válidos.','validation_error');
    if(fixed&&proposed!==original)return fail(res,409,`El bloque ${index+1} está fijado y no puede recortarse en esta simulación.`,'conflict');
    blocks.push({blockId:uuid(b.blockId)?b.blockId:null,index,title:clean(b.title,180),originalMinutes:original,proposedMinutes:proposed,minimumMinutes:minimum,fixed});
  }
  const preview={blocks,deltaMinutes:blocks.reduce((total,b)=>total+b.proposedMinutes-b.originalMinutes,0),recoveredMinutes:blocks.reduce((total,b)=>total+Math.max(0,b.originalMinutes-b.proposedMinutes),0),createdAt:new Date().toISOString()};
  const {data,error}=await supabase.from('tshow_timing_adjustments').insert({project_id:req.params.id,base_document_version:a.project.document_version,preview,created_by:req.user.id}).select().single();
  if(error)return fail(res,400,'No se pudo guardar la simulación.','validation_error');
  await audit(req.params.id,req.user.id,'operational.timing_adjustment.previewed',{adjustmentId:data.id,recoveredMinutes:preview.recoveredMinutes});
  res.status(201).json({success:true,data});
});

router.post('/projects/:id/timing-adjustments/:adjustmentId/apply', requireSupabaseAuth, guard, async (req,res)=>{
  const a=await access(req.params.id,true); if(!canManage(a))return fail(res,403,'Solo el propietario o administrador puede aplicar ajustes.','forbidden');
  const {data:adjustment}=await supabase.from('tshow_timing_adjustments').select('*').eq('id',req.params.adjustmentId).eq('project_id',req.params.id).eq('status','preview').maybeSingle();
  if(!adjustment)return fail(res,404,'La simulación no existe o ya fue aplicada.','not_found');
  if(Number(req.body.expectedDocumentVersion)!==Number(a.project.document_version)||Number(adjustment.base_document_version)!==Number(a.project.document_version))return fail(res,409,'La pauta cambió. Genera una nueva simulación antes de aplicar.','conflict');
  const payload=JSON.parse(JSON.stringify(a.project.payload||{})); const rows=Array.isArray(payload.blocks)?payload.blocks:[];
  for(const item of adjustment.preview.blocks||[]){const row=item.blockId?rows.find(b=>String(b.id||b.externalId||'')===String(item.blockId)):rows[item.index];if(!row) return fail(res,409,'Uno de los bloques ya no existe. Genera una nueva simulación.','conflict');if(item.fixed&&Number(row.duration)!==Number(item.originalMinutes))return fail(res,409,'Un bloque fijado cambió desde la simulación.','conflict');row.duration=String(item.proposedMinutes);}
  const nextVersion=Number(a.project.document_version||0)+1;
  const {data:updated,error:updateError}=await supabase.from('tshow_projects').update({payload,document_version:nextVersion}).eq('id',req.params.id).eq('document_version',a.project.document_version).select('id,document_version').maybeSingle();
  if(updateError||!updated)return fail(res,409,'La pauta cambió durante la aplicación.','conflict');
  await supabase.from('tshow_project_document_versions').insert({project_id:req.params.id,version:nextVersion,snapshot:payload,created_by:req.user.id,reason:'Ajuste operativo de atraso'});
  await supabase.from('tshow_timing_adjustments').update({status:'applied',applied_by:req.user.id,applied_at:new Date().toISOString()}).eq('id',adjustment.id);
  await audit(req.params.id,req.user.id,'operational.timing_adjustment.applied',{adjustmentId:adjustment.id,version:nextVersion});
  res.json({success:true,data:updated});
});

// Recipient-scoped notice reads are registered before the legacy project-wide
// handler below, keeping old clients compatible without exposing directed
// notices to another project member.
router.get('/projects/:id/notices', requireSupabaseAuth, guard, async (req,res,next)=>{
  const a=await access(req,req.params.id); if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');
  const [{data:notices,error:noticeError},{data:recipients,error:recipientError}]=await Promise.all([
    supabase.from('tshow_operational_notices').select('*').eq('project_id',req.params.id).order('created_at',{ascending:false}).limit(100),
    supabase.from('tshow_operational_notice_recipients').select('*').eq('user_id',req.user.id)
  ]);
  if(noticeError||recipientError)return next(noticeError||recipientError);
  const byNotice=new Map((recipients||[]).map(row=>[row.notice_id,row]));
  const data=(notices||[]).filter(notice=>notice.created_by===req.user.id||byNotice.has(notice.id)).map(notice=>({...notice,recipient:byNotice.get(notice.id)||null}));
  res.json({success:true,data,unconfirmedCount:data.filter(notice=>notice.recipient&&!notice.recipient.confirmed_at).length});
});

router.patch('/projects/:id/operational-feature', requireSupabaseAuth, async (req,res)=>{const a=await access(req,req.params.id,true);if(!canManage(a))return fail(res,403,'Solo el propietario o administrador puede habilitar Producción.','forbidden');const enabledValue=req.body.enabled===true;const {data,error}=await supabase.from('tshow_operational_feature_flags').upsert({project_id:req.params.id,enabled:enabledValue,enabled_by:req.user.id,enabled_at:enabledValue?new Date().toISOString():null,updated_at:new Date().toISOString()},{onConflict:'project_id'}).select().single();if(error)return fail(res,400,'No se pudo actualizar la habilitación operativa.','validation_error');await audit(req.params.id,req.user.id,'operational.feature.updated',{enabled:enabledValue});res.json({success:true,data});});
router.get('/projects/:id/production', requireSupabaseAuth, guard, async (req, res) => {
  const a = await access(req, req.params.id); if (!a) return fail(res, 403, 'No tienes acceso operativo a este evento.', 'forbidden');
  const [areas, tasks, artists, appearances, notices, readiness] = await Promise.all([
    supabase.from('tshow_project_areas').select('*').eq('project_id', req.params.id).eq('status','active').order('name'),
    supabase.from('tshow_tasks').select('*').eq('project_id', req.params.id).order('due_at'),
    supabase.from('tshow_artists').select('*').eq('project_id', req.params.id).order('name'),
    supabase.from('tshow_artist_appearances').select('*').eq('project_id', req.params.id).order('updated_at',{ascending:false}),
    supabase.from('tshow_operational_notices').select('id,title,body,block_id,area_id,created_by,created_at,tshow_operational_notice_recipients(user_id,seen_at,confirmed_at)').eq('project_id', req.params.id).order('created_at',{ascending:false}).limit(30),
    supabase.from('tshow_block_area_readiness').select('*,tshow_project_areas(name,area_key),tshow_project_blocks(title,position,start_time)').eq('project_id', req.params.id).order('updated_at',{ascending:false})
  ]);
  const errors = [areas,tasks,artists,appearances,notices,readiness].find(x => x.error); if (errors) return fail(res, 500, 'No se pudo cargar el espacio operativo.', 'service_unavailable');
  const visibleNotices=(notices.data||[]).map(({tshow_operational_notice_recipients,...notice})=>({...notice,recipient:(tshow_operational_notice_recipients||[]).find(recipient=>recipient.user_id===req.user.id)||null}));
  res.json({ success:true, enabled:true, serverTime:new Date().toISOString(), project:{ id:a.project.id, documentVersion:a.project.document_version }, data:{ areas:areas.data||[], tasks:tasks.data||[], artists:artists.data||[], appearances:appearances.data||[], notices:visibleNotices, readiness:readiness.data||[] }, capabilities:{ manageAreas:canManage(a), editOperational:canWrite(a), createRehearsal:canManage(a) } });
});

router.get('/projects/:id/areas', requireSupabaseAuth, guard, async (req,res)=>{ const a=await access(req,req.params.id); if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden'); const {data,error}=await supabase.from('tshow_project_areas').select('*,tshow_project_area_members(user_id,can_update)').eq('project_id',req.params.id).order('name'); if(error)return fail(res,500,'No se pudieron cargar las áreas.'); res.json({success:true,data:data||[]}); });
router.post('/projects/:id/areas', requireSupabaseAuth, guard, async (req,res)=>{ const a=await access(req,req.params.id,true); if(!canManage(a))return fail(res,403,'Solo el propietario o administrador puede gestionar áreas.','forbidden'); const name=clean(req.body.name,100); const key=clean(req.body.areaKey,60).toLowerCase().replace(/[^a-z0-9_-]/g,'-'); if(name.length<2||key.length<2)return fail(res,400,'Nombre y clave de área son obligatorios.','validation_error'); const {data,error}=await supabase.from('tshow_project_areas').insert({project_id:req.params.id,name,area_key:key,created_by:req.user.id}).select().single(); if(error)return fail(res,409,'El área ya existe o no es válida.','conflict'); await audit(req.params.id,req.user.id,'operational.area.created',{areaId:data.id}); res.status(201).json({success:true,data}); });

router.post('/projects/:id/areas/apply-template', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canManage(a))return fail(res,403,'Solo el propietario o administrador puede aplicar la plantilla.','forbidden');const names=[['sound','Sonido'],['lighting','Iluminación'],['screens','Pantallas'],['stage','Escenario'],['dressing','Camarines']];const {data,error}=await supabase.from('tshow_project_areas').upsert(names.map(([area_key,name])=>({project_id:req.params.id,area_key,name,created_by:req.user.id})),{onConflict:'project_id,area_key',ignoreDuplicates:true}).select();if(error)return fail(res,400,'No se pudo aplicar la plantilla de áreas.','validation_error');await audit(req.params.id,req.user.id,'operational.area.template_applied',{count:data?.length||0});res.json({success:true,data:data||[]});});
router.get('/projects/:id/technical-cues', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id);if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');const {data,error}=await supabase.from('tshow_technical_cues').select('*').eq('project_id',req.params.id).order('updated_at',{ascending:false});if(error)return fail(res,500,'No se pudieron cargar las indicaciones.');res.json({success:true,data:data||[]});});
router.post('/projects/:id/technical-cues', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canWrite(a))return fail(res,403,'No tienes permisos para editar indicaciones.','forbidden');if(!uuid(req.body.areaId))return fail(res,400,'Área inválida.','validation_error');const patch={project_id:req.params.id,block_id:uuid(req.body.blockId)?req.body.blockId:null,area_id:req.body.areaId,body:clean(req.body.body,4000),updated_by:req.user.id};const {data,error}=await supabase.from('tshow_technical_cues').upsert(patch,{onConflict:'project_id,block_id,area_id'}).select().single();if(error)return fail(res,400,'No se pudo guardar la indicación.','validation_error');await audit(req.params.id,req.user.id,'operational.cue.updated',{cueId:data.id});res.json({success:true,data});});

router.get('/projects/:id/readiness-summary', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id);if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');const {data,error}=await supabase.from('tshow_block_area_readiness').select('*,tshow_project_areas(name,area_key),tshow_project_blocks(title,position,start_time)').eq('project_id',req.params.id).order('updated_at',{ascending:false});if(error)return fail(res,500,'No se pudo cargar la preparación.');res.json({success:true,data:data||[]});});
router.patch('/projects/:id/readiness/:readinessId', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req.params.id?req:req,req.params.id);if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');const status=['pending','preparing','ready','problem','not_applicable'].includes(req.body.status)?req.body.status:null;if(!status)return fail(res,400,'Estado de preparación inválido.','validation_error');const {data:row}=await supabase.from('tshow_block_area_readiness').select('id,area_id').eq('id',req.params.readinessId).eq('project_id',req.params.id).maybeSingle();if(!row)return fail(res,404,'Preparación no encontrada.','not_found');let allowed=canWrite(a);if(!allowed){const {data:m}=await supabase.from('tshow_project_area_members').select('can_update').eq('area_id',row.area_id).eq('user_id',req.user.id).maybeSingle();allowed=Boolean(m?.can_update);}if(!allowed)return fail(res,403,'No tienes permiso para actualizar esta área.','forbidden');const {data,error}=await supabase.from('tshow_block_area_readiness').update({status,note:clean(req.body.note,2000),confirmed_by:req.user.id,confirmed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',row.id).select().single();if(error)return fail(res,400,'No se pudo actualizar la preparación.','validation_error');await audit(req.params.id,req.user.id,'operational.readiness.updated',{readinessId:row.id,status});res.json({success:true,data});});

router.get('/projects/:id/artists', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id);if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');const {data,error}=await supabase.from('tshow_artists').select('*,tshow_artist_appearances(*)').eq('project_id',req.params.id).order('name');if(error)return fail(res,500,'No se pudieron cargar los artistas.');res.json({success:true,data:data||[]});});
router.post('/projects/:id/artists', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canWrite(a))return fail(res,403,'No tienes permisos para gestionar artistas.','forbidden');const name=clean(req.body.name,180);if(name.length<2)return fail(res,400,'El nombre del artista es obligatorio.','validation_error');const {data,error}=await supabase.from('tshow_artists').insert({project_id:req.params.id,name,kind:clean(req.body.kind,40)||'artist',notes:clean(req.body.notes,4000),created_by:req.user.id}).select().single();if(error)return fail(res,400,'No se pudo crear el artista.','validation_error');res.status(201).json({success:true,data});});

router.get('/projects/:id/notices', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id);if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');const {data,error}=await supabase.from('tshow_operational_notices').select('*,tshow_operational_notice_recipients(*)').eq('project_id',req.params.id).order('created_at',{ascending:false}).limit(100);if(error)return fail(res,500,'No se pudieron cargar los avisos.');res.json({success:true,data:data||[]});});
router.post('/projects/:id/notices', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canWrite(a))return fail(res,403,'No tienes permisos para enviar avisos.','forbidden');const title=clean(req.body.title,180),body=clean(req.body.body,2000);if(title.length<2||!body)return fail(res,400,'Título y mensaje son obligatorios.','validation_error');const idempotencyKey=clean(req.body.idempotencyKey,120)||null;if(idempotencyKey){const {data:existing}=await supabase.from('tshow_operational_notices').select('*').eq('project_id',req.params.id).eq('idempotency_key',idempotencyKey).maybeSingle();if(existing)return res.status(200).json({success:true,data:existing,idempotent:true});}const {data,error}=await supabase.from('tshow_operational_notices').insert({project_id:req.params.id,title,body,block_id:uuid(req.body.blockId)?req.body.blockId:null,area_id:uuid(req.body.areaId)?req.body.areaId:null,created_by:req.user.id,idempotency_key:idempotencyKey}).select().single();if(error)return fail(res,400,'No se pudo enviar el aviso.','validation_error');let requested=Array.isArray(req.body.userIds)?req.body.userIds.filter(uuid):[];if(req.body.audience==='all'){const {data:members}=await supabase.from('tshow_project_members').select('user_id').eq('project_id',req.params.id);requested=[a.project.owner_id,...(members||[]).map(item=>item.user_id)];}if(uuid(req.body.areaId)){const {data:areaMembers}=await supabase.from('tshow_project_area_members').select('user_id').eq('area_id',req.body.areaId);requested=[...(requested||[]),...(areaMembers||[]).map(item=>item.user_id)];}const unique=[...new Set(requested)].filter(userId=>userId===a.project.owner_id);if(req.body.audience==='all'||req.body.areaId||requested.length){const {data:members}=await supabase.from('tshow_project_members').select('user_id').eq('project_id',req.params.id);const allowed=new Set([a.project.owner_id,...(members||[]).map(item=>item.user_id)]);unique.push(...[...new Set(requested)].filter(userId=>allowed.has(userId)));}const recipients=[...new Set(unique)];if(recipients.length){const {error:recipientError}=await supabase.from('tshow_operational_notice_recipients').insert(recipients.map(user_id=>({notice_id:data.id,user_id})));if(recipientError)return fail(res,400,'El aviso se creó pero no se pudieron asignar destinatarios.','partial_failure');}await audit(req.params.id,req.user.id,'operational.notice.created',{noticeId:data.id,recipientCount:recipients.length});res.status(201).json({success:true,data:{...data,recipientCount:recipients.length}});});
router.post('/projects/:id/notices', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canWrite(a))return fail(res,403,'No tienes permisos para enviar avisos.','forbidden');const title=clean(req.body.title,180),body=clean(req.body.body,2000);if(title.length<2||!body)return fail(res,400,'Título y mensaje son obligatorios.','validation_error');const {data,error}=await supabase.from('tshow_operational_notices').insert({project_id:req.params.id,title,body,block_id:uuid(req.body.blockId)?req.body.blockId:null,area_id:uuid(req.body.areaId)?req.body.areaId:null,created_by:req.user.id,idempotency_key:clean(req.body.idempotencyKey,120)||null}).select().single();if(error?.code==='23505')return res.status(200).json({success:true,data:{idempotent:true}});if(error)return fail(res,400,'No se pudo enviar el aviso.','validation_error');const recipients=Array.isArray(req.body.userIds)?req.body.userIds.filter(uuid).slice(0,100):[];if(recipients.length){const {error:recipientError}=await supabase.from('tshow_operational_notice_recipients').insert(recipients.map(user_id=>({notice_id:data.id,user_id})));if(recipientError)return fail(res,400,'El aviso se creó pero no se pudieron asignar destinatarios.','partial_failure');}await audit(req.params.id,req.user.id,'operational.notice.created',{noticeId:data.id});res.status(201).json({success:true,data});});
router.post('/projects/:id/notices/:noticeId/confirm', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id);if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');const {data,error}=await supabase.from('tshow_operational_notice_recipients').update({confirmed_at:new Date().toISOString()}).eq('notice_id',req.params.noticeId).eq('user_id',req.user.id).select().single();if(error)return fail(res,403,'Este aviso no está dirigido a tu cuenta.','forbidden');res.json({success:true,data});});

router.get('/projects/:id/rehearsals', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id);if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');const {data,error}=await supabase.from('tshow_rehearsals').select('*').eq('project_id',req.params.id).order('created_at',{ascending:false});if(error)return fail(res,500,'No se pudieron cargar los ensayos.');res.json({success:true,data:data||[]});});
router.post('/projects/:id/rehearsals', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canManage(a))return fail(res,403,'Solo el propietario o administrador puede crear ensayos.','forbidden');const name=clean(req.body.name,180);if(name.length<2)return fail(res,400,'El nombre del ensayo es obligatorio.','validation_error');const source=JSON.parse(JSON.stringify(a.project.payload||{}));const {data,error}=await supabase.from('tshow_rehearsals').insert({project_id:req.params.id,name,source_document_version:a.project.document_version,snapshot:source,current_index:0,elapsed_seconds:0,created_by:req.user.id}).select().single();if(error)return fail(res,400,'No se pudo crear el ensayo.','validation_error');await audit(req.params.id,req.user.id,'operational.rehearsal.created',{rehearsalId:data.id});res.status(201).json({success:true,data});});

router.post('/projects/:id/timing-adjustments/preview', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canWrite(a))return fail(res,403,'No tienes permisos para proponer ajustes.','forbidden');const blocks=Array.isArray(req.body.blocks)?req.body.blocks.map((b,index)=>({blockId:uuid(b.blockId)?b.blockId:null,index,title:clean(b.title,180),originalMinutes:Math.max(1,Number(b.originalMinutes)||0),proposedMinutes:Math.max(1,Number(b.proposedMinutes)||0),fixed:Boolean(b.fixed)})):[];if(!blocks.length)return fail(res,400,'Debes incluir bloques para simular.','validation_error');if(blocks.some(b=>b.proposedMinutes<1))return fail(res,400,'Cada duración debe ser positiva.','validation_error');const preview={blocks,deltaMinutes:blocks.reduce((n,b)=>n+b.proposedMinutes-b.originalMinutes,0),createdAt:new Date().toISOString()};const {data,error}=await supabase.from('tshow_timing_adjustments').insert({project_id:req.params.id,base_document_version:a.project.document_version,preview,created_by:req.user.id}).select().single();if(error)return fail(res,400,'No se pudo guardar la simulación.','validation_error');res.status(201).json({success:true,data});});

router.patch('/projects/:id/areas/:areaId', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canManage(a))return fail(res,403,'Solo el propietario o administrador puede editar áreas.','forbidden');const patch={};if(req.body.name!==undefined)patch.name=clean(req.body.name,100);if(req.body.status!==undefined&&['active','archived'].includes(req.body.status))patch.status=req.body.status;if(req.body.responsibleId!==undefined)patch.responsible_id=uuid(req.body.responsibleId)?req.body.responsibleId:null;const {data,error}=await supabase.from('tshow_project_areas').update(patch).eq('id',req.params.areaId).eq('project_id',req.params.id).select().single();if(error)return fail(res,400,'No se pudo actualizar el área.','validation_error');await audit(req.params.id,req.user.id,'operational.area.updated',{areaId:data.id});res.json({success:true,data});});
router.post('/projects/:id/areas/:areaId/members', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canManage(a)||!uuid(req.body.userId))return fail(res,403,'No tienes permisos para asignar esta área.','forbidden');const {data:area}=await supabase.from('tshow_project_areas').select('id').eq('id',req.params.areaId).eq('project_id',req.params.id).maybeSingle();if(!area)return fail(res,404,'Área no encontrada.','not_found');const {data:member}=await supabase.from('tshow_project_members').select('user_id').eq('project_id',req.params.id).eq('user_id',req.body.userId).maybeSingle();if(!member&&req.body.userId!==a.project.owner_id)return fail(res,400,'La persona no pertenece al evento.','validation_error');const {data,error}=await supabase.from('tshow_project_area_members').upsert({area_id:req.params.areaId,user_id:req.body.userId,can_update:req.body.canUpdate!==false}).select().single();if(error)return fail(res,400,'No se pudo asignar el área.','validation_error');res.status(201).json({success:true,data});});
router.get('/projects/:id/readiness', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id);if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');const [{data:areas,error:areaError},{data:blocks,error:blockError}]=await Promise.all([supabase.from('tshow_project_areas').select('id,name,area_key').eq('project_id',req.params.id).eq('status','active'),supabase.from('tshow_project_blocks').select('id,title,position,start_time').eq('project_id',req.params.id).order('position')]);if(areaError||blockError)return fail(res,500,'No se pudo cargar la preparación.','service_unavailable');const pairs=(blocks||[]).flatMap(block=>(areas||[]).map(area=>({project_id:req.params.id,block_id:block.id,area_id:area.id})));if(pairs.length)await supabase.from('tshow_block_area_readiness').upsert(pairs,{onConflict:'block_id,area_id',ignoreDuplicates:true});const {data,error}=await supabase.from('tshow_block_area_readiness').select('*,tshow_project_areas(name,area_key),tshow_project_blocks(title,position,start_time)').eq('project_id',req.params.id).order('updated_at',{ascending:false});if(error)return fail(res,500,'No se pudo cargar la preparación.');res.json({success:true,data:data||[]});});
router.post('/projects/:id/artists/:artistId/appearances', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canWrite(a))return fail(res,403,'No tienes permisos para gestionar presentaciones.','forbidden');const {data,error}=await supabase.from('tshow_artist_appearances').insert({project_id:req.params.id,artist_id:req.params.artistId,block_id:uuid(req.body.blockId)?req.body.blockId:null,call_time:clean(req.body.callTime,10)||null,dressing_room:clean(req.body.dressingRoom,100)||null,responsible_id:uuid(req.body.responsibleId)?req.body.responsibleId:null}).select().single();if(error)return fail(res,400,'No se pudo crear la presentación.','validation_error');res.status(201).json({success:true,data});});
router.patch('/projects/:id/appearances/:appearanceId', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canWrite(a))return fail(res,403,'No tienes permisos para actualizar la presentación.','forbidden');const patch={updated_by:req.user.id};if(req.body.status&&['expected','on_site','in_dressing_room','ready','finished'].includes(req.body.status))patch.status=req.body.status;if(req.body.dressingRoom!==undefined)patch.dressing_room=clean(req.body.dressingRoom,100);const {data,error}=await supabase.from('tshow_artist_appearances').update(patch).eq('id',req.params.appearanceId).eq('project_id',req.params.id).select().single();if(error)return fail(res,400,'No se pudo actualizar el estado del artista.','validation_error');res.json({success:true,data});});
router.patch('/projects/:id/rehearsals/:rehearsalId', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canManage(a))return fail(res,403,'Solo el propietario o administrador puede controlar ensayos.','forbidden');const status=['draft','running','paused','finished','cancelled'].includes(req.body.status)?req.body.status:null;if(!status)return fail(res,400,'Estado de ensayo inválido.','validation_error');const patch={status,updated_at:new Date().toISOString()};if(req.body.simulatedNow!==undefined)patch.simulated_now=req.body.simulatedNow||null;if(req.body.currentIndex!==undefined)patch.current_index=Math.max(0,Number(req.body.currentIndex)||0);if(req.body.elapsedSeconds!==undefined)patch.elapsed_seconds=Math.max(0,Number(req.body.elapsedSeconds)||0);const {data,error}=await supabase.from('tshow_rehearsals').update(patch).eq('id',req.params.rehearsalId).eq('project_id',req.params.id).select().single();if(error)return fail(res,400,'No se pudo actualizar el ensayo.','validation_error');await audit(req.params.id,req.user.id,'operational.rehearsal.controlled',{rehearsalId:req.params.rehearsalId,status});res.json({success:true,data});});
router.get('/projects/:id/timing-adjustments', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id);if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');const {data,error}=await supabase.from('tshow_timing_adjustments').select('id,base_document_version,preview,status,created_by,created_at,applied_at').eq('project_id',req.params.id).order('created_at',{ascending:false}).limit(30);if(error)return fail(res,500,'No se pudieron cargar las simulaciones.','service_unavailable');res.json({success:true,data:data||[]});});
router.get('/projects/:id/tasks', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id);if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');let query=supabase.from('tshow_tasks').select('*,tshow_task_events(*)').eq('project_id',req.params.id).order('due_at');if(req.query.areaId&&uuid(req.query.areaId))query=query.eq('area_id',req.query.areaId);const {data,error}=await query;if(error)return fail(res,500,'No se pudo cargar la checklist.','service_unavailable');res.json({success:true,data:data||[]});});
router.post('/projects/:id/tasks', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canWrite(a))return fail(res,403,'No tienes permisos para crear tareas.','forbidden');const title=clean(req.body.title,180);if(title.length<2)return fail(res,400,'El título de la tarea es obligatorio.','validation_error');const status=['pending','in_progress','blocked','completed','cancelled','not_applicable'].includes(req.body.status)?req.body.status:'pending';if(status==='not_applicable'&&!clean(req.body.notApplicableReason,1000))return fail(res,400,'Indica por qué la tarea no aplica.','validation_error');const {data,error}=await supabase.from('tshow_tasks').insert({project_id:req.params.id,title,description:clean(req.body.description,4000),status,priority:['low','medium','high','critical'].includes(req.body.priority)?req.body.priority:'medium',assigned_to:uuid(req.body.assignedTo)?req.body.assignedTo:null,area_id:uuid(req.body.areaId)?req.body.areaId:null,task_kind:clean(req.body.taskKind,40)||'operational',not_applicable_reason:clean(req.body.notApplicableReason,1000),blocked_reason:clean(req.body.blockedReason,1000),created_by:req.user.id,last_changed_by:req.user.id}).select().single();if(error)return fail(res,400,'No se pudo crear la tarea.','validation_error');await supabase.from('tshow_task_events').insert({task_id:data.id,project_id:req.params.id,actor_id:req.user.id,to_status:data.status,note:'Tarea creada'});res.status(201).json({success:true,data});});
router.patch('/projects/:id/tasks/:taskId', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canWrite(a))return fail(res,403,'No tienes permisos para actualizar tareas.','forbidden');const {data:previous}=await supabase.from('tshow_tasks').select('status').eq('id',req.params.taskId).eq('project_id',req.params.id).maybeSingle();if(!previous)return fail(res,404,'Tarea no encontrada.','not_found');const patch={last_changed_by:req.user.id,updated_at:new Date().toISOString()};if(req.body.title!==undefined)patch.title=clean(req.body.title,180);if(req.body.description!==undefined)patch.description=clean(req.body.description,4000);if(req.body.areaId!==undefined)patch.area_id=uuid(req.body.areaId)?req.body.areaId:null;if(req.body.assignedTo!==undefined)patch.assigned_to=uuid(req.body.assignedTo)?req.body.assignedTo:null;if(req.body.status!==undefined&&['pending','in_progress','blocked','completed','cancelled','not_applicable'].includes(req.body.status))patch.status=req.body.status;if(req.body.notApplicableReason!==undefined)patch.not_applicable_reason=clean(req.body.notApplicableReason,1000);if(req.body.blockedReason!==undefined)patch.blocked_reason=clean(req.body.blockedReason,1000);if(patch.status==='not_applicable'&&!patch.not_applicable_reason)return fail(res,400,'Indica por qué la tarea no aplica.','validation_error');const {data,error}=await supabase.from('tshow_tasks').update(patch).eq('id',req.params.taskId).eq('project_id',req.params.id).select().single();if(error)return fail(res,400,'No se pudo actualizar la tarea.','validation_error');if(previous.status!==data.status)await supabase.from('tshow_task_events').insert({task_id:data.id,project_id:req.params.id,actor_id:req.user.id,from_status:previous.status,to_status:data.status,note:clean(req.body.note,2000)});res.json({success:true,data});});
router.post('/projects/:id/timing-adjustments/:adjustmentId/apply', requireSupabaseAuth, guard, async(req,res)=>{const a=await access(req,req.params.id,true);if(!canManage(a))return fail(res,403,'Solo el propietario o administrador puede aplicar ajustes.','forbidden');const {data:adjustment}=await supabase.from('tshow_timing_adjustments').select('*').eq('id',req.params.adjustmentId).eq('project_id',req.params.id).eq('status','preview').maybeSingle();if(!adjustment)return fail(res,404,'La simulación no existe o ya fue aplicada.','not_found');if(Number(req.body.expectedDocumentVersion)!==Number(a.project.document_version)||Number(adjustment.base_document_version)!==Number(a.project.document_version))return fail(res,409,'La pauta cambió. Genera una nueva simulación antes de aplicar.','conflict');const nextPayload=JSON.parse(JSON.stringify(a.project.payload||{}));const rows=Array.isArray(nextPayload.blocks)?nextPayload.blocks:[];for(const item of adjustment.preview.blocks||[]){const row=item.blockId?rows.find(b=>String(b.id||b.externalId||'')===String(item.blockId)):rows[item.index];if(row)row.duration=String(item.proposedMinutes);}
  const {data:updated,error:updateError}=await supabase.from('tshow_projects').update({payload:nextPayload}).eq('id',req.params.id).eq('document_version',a.project.document_version).select('id,document_version').maybeSingle();if(updateError||!updated)return fail(res,409,'La pauta cambió durante la aplicación.','conflict');await supabase.from('tshow_timing_adjustments').update({status:'applied',applied_by:req.user.id,applied_at:new Date().toISOString()}).eq('id',adjustment.id);await audit(req.params.id,req.user.id,'operational.timing_adjustment.applied',{adjustmentId:adjustment.id});res.json({success:true,data:updated});});

router.post('/projects/:id/tasks/apply-template', requireSupabaseAuth, guard, async(req,res)=>{
  const a=await access(req.params.id,true); if(!canWrite(a))return fail(res,403,'No tienes permisos para aplicar la checklist.','forbidden');
  const templates=[['sound','Revisar micrófonos y líneas','Confirmar prueba de sonido antes de abrir puertas.'],['lighting','Verificar luces de escena','Confirmar escenas y respaldo de operación.'],['screens','Cargar videos y gráficas','Probar reproducción y formato de cada pieza.'],['stage','Revisar escenario','Confirmar montaje, accesos y seguridad.'],['dressing','Confirmar artistas y camarines','Validar llegada y preparación del siguiente artista.'],['doors','Preparar apertura de puertas','Coordinar acceso, señalética y equipo de atención.']];
  const {data:areas,error:areaError}=await supabase.from('tshow_project_areas').select('id,area_key').eq('project_id',req.params.id).eq('status','active');
  if(areaError)return fail(res,500,'No se pudo leer la plantilla de áreas.','service_unavailable');
  const areaByKey=new Map((areas||[]).map(area=>[area.area_key,area.id])); const {data:existing,error:existingError}=await supabase.from('tshow_tasks').select('id,title,task_kind').eq('project_id',req.params.id).eq('task_kind','template');
  if(existingError)return fail(res,500,'No se pudo comprobar la checklist existente.','service_unavailable'); const existingTitles=new Set((existing||[]).map(task=>task.title));
  const rows=templates.filter(([key,title])=>!existingTitles.has(title)).map(([key,title,description])=>({project_id:req.params.id,title,description,status:'pending',priority:'high',area_id:areaByKey.get(key)||null,task_kind:'template',created_by:req.user.id,last_changed_by:req.user.id}));
  let created=[]; if(rows.length){const {data,error}=await supabase.from('tshow_tasks').insert(rows).select();if(error)return fail(res,400,'No se pudo aplicar la checklist inicial.','validation_error');created=data||[];await supabase.from('tshow_task_events').insert(created.map(task=>({task_id:task.id,project_id:req.params.id,actor_id:req.user.id,to_status:'pending',note:'Tarea creada desde plantilla'})));}
  await audit(req.params.id,req.user.id,'operational.task.template_applied',{createdCount:created.length,skippedCount:templates.length-created.length}); res.status(201).json({success:true,data:created,skipped:templates.length-created.length});
});
// A recipient-scoped inbox keeps directed notices private while preserving the
// existing project notice route for backwards-compatible clients.
router.get('/operational-inbox', requireSupabaseAuth, async (req,res)=>{
  try {
    const [{data:owned,error:ownedError},{data:members,error:membersError}]=await Promise.all([
      supabase.from('tshow_projects').select('id,event_name').eq('owner_id',req.user.id).is('deleted_at',null),
      supabase.from('tshow_project_members').select('project_id').eq('user_id',req.user.id)
    ]);
    if(ownedError||membersError)return fail(res,503,'No se pudo cargar la bandeja operativa.','service_unavailable');
    const projectIds=[...new Set([...(owned||[]).map(row=>row.id),...(members||[]).map(row=>row.project_id)])];
    if(!projectIds.length)return res.json({success:true,data:[],unreadCount:0});
    const {data:recipients,error:recipientError}=await supabase.from('tshow_operational_notice_recipients').select('notice_id,seen_at,confirmed_at').eq('user_id',req.user.id).is('seen_at',null).limit(100);
    if(recipientError)return fail(res,503,'No se pudo cargar la bandeja operativa.','service_unavailable');
    const noticeIds=(recipients||[]).map(row=>row.notice_id).filter(uuid);
    if(!noticeIds.length)return res.json({success:true,data:[],unreadCount:0});
    const [{data:flags,error:flagError},{data:notices,error:noticeError},{data:projects,error:projectError}]=await Promise.all([
      supabase.from('tshow_operational_feature_flags').select('project_id').in('project_id',projectIds).eq('enabled',true),
      supabase.from('tshow_operational_notices').select('id,project_id,title,body,block_id,created_by,created_at').in('id',noticeIds).in('project_id',projectIds).order('created_at',{ascending:false}).limit(100),
      supabase.from('tshow_projects').select('id,event_name').in('id',projectIds)
    ]);
    if(flagError||noticeError||projectError)return fail(res,503,'No se pudo cargar la bandeja operativa.','service_unavailable');
    const enabledProjects=new Set((flags||[]).map(row=>row.project_id));
    const recipientByNotice=new Map((recipients||[]).map(row=>[row.notice_id,row]));
    const projectNames=new Map((projects||[]).map(row=>[row.id,row.event_name]));
    const data=(notices||[]).filter(notice=>enabledProjects.has(notice.project_id)).map(notice=>({...notice,eventName:projectNames.get(notice.project_id)||'Evento',recipient:recipientByNotice.get(notice.id)||null}));
    res.json({success:true,data,unreadCount:data.length});
  } catch (_) { return fail(res,503,'No se pudo cargar la bandeja operativa.','service_unavailable'); }
});
router.get('/projects/:id/operational-inbox', requireSupabaseAuth, guard, async (req,res)=>{
  const a=await access(req,req.params.id); if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');
  const [{data:notices,error:noticeError},{data:recipients,error:recipientError}]=await Promise.all([
    supabase.from('tshow_operational_notices').select('*').eq('project_id',req.params.id).order('created_at',{ascending:false}).limit(100),
    supabase.from('tshow_operational_notice_recipients').select('*').eq('user_id',req.user.id)
  ]);
  if(noticeError||recipientError)return fail(res,500,'No se pudo cargar la bandeja operativa.','service_unavailable');
  const recipientByNotice=new Map((recipients||[]).map(row=>[row.notice_id,row]));
  const visible=(notices||[]).filter(notice=>notice.created_by===req.user.id||recipientByNotice.has(notice.id)).map(notice=>({...notice,recipient:recipientByNotice.get(notice.id)||null}));
  res.json({success:true,data:visible,unconfirmedCount:visible.filter(notice=>notice.recipient&&!notice.recipient.confirmed_at).length});
});
router.post('/projects/:id/notices/:noticeId/seen', requireSupabaseAuth, guard, async(req,res)=>{
  const a=await access(req,req.params.id); if(!a)return fail(res,403,'No tienes acceso a este evento.','forbidden');
  const {data,error}=await supabase.from('tshow_operational_notice_recipients').update({seen_at:new Date().toISOString()}).eq('notice_id',req.params.noticeId).eq('user_id',req.user.id).select().maybeSingle();
  if(error||!data)return fail(res,403,'Este aviso no está dirigido a tu cuenta.','forbidden');
  res.json({success:true,data});
});
router.delete('/projects/:id/areas/:areaId/members/:userId', requireSupabaseAuth, guard, async(req,res)=>{
  const a=await access(req,req.params.id,true); if(!canManage(a))return fail(res,403,'Solo el propietario o administrador puede quitar responsables.','forbidden');
  const {error}=await supabase.from('tshow_project_area_members').delete().eq('area_id',req.params.areaId).eq('user_id',req.params.userId);
  if(error)return fail(res,400,'No se pudo quitar la asignación.','validation_error');
  await audit(req.params.id,req.user.id,'operational.area.member_removed',{areaId:req.params.areaId,userId:req.params.userId});
  res.json({success:true});
});
module.exports = router;
