const express = require('express');
const { supabase } = require('../supabaseClient');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');

const router = express.Router();
const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

async function access(req, projectId, edit = false) {
  const { data: project } = await supabase.from('tshow_projects').select('*').eq('id', projectId).is('deleted_at', null).maybeSingle();
  if (!project) return null;
  if (req.user.profile?.role === 'platform_admin' || project.owner_id === req.user.id) return project;
  if (project.organization_id) {
    const { data: org } = await supabase.from('tshow_organization_members').select('role')
      .eq('organization_id', project.organization_id).eq('user_id', req.user.id).maybeSingle();
    if (org && (!edit || ['owner','admin'].includes(org.role))) return project;
  }
  const { data: member } = await supabase.from('tshow_project_members').select('role')
    .eq('project_id', projectId).eq('user_id', req.user.id).maybeSingle();
  return member && (!edit || member.role === 'editor') ? project : null;
}

router.get('/projects/:id/sync', requireSupabaseAuth, async (req, res) => {
  const project = await access(req, req.params.id);
  if (!project) return fail(res, 403, 'No tienes acceso a este evento.');
  const after = Math.max(Number.parseInt(req.query.after, 10) || 0, 0);
  const { data: operations, error } = await supabase.from('tshow_sync_operations')
    .select('id,actor_id,client_id,client_operation_id,base_version,resulting_version,operation_type,status,created_at')
    .eq('project_id', req.params.id).gt('id', after).order('id').limit(500);
  if (error) return fail(res, 500, error.message);
  res.json({ success: true, data: { project: { id: project.id, payload: project.payload, version: project.document_version, updatedAt: project.updated_at }, operations: operations || [], cursor: operations?.at(-1)?.id || after } });
});

router.post('/projects/:id/sync', requireSupabaseAuth, async (req, res) => {
  const project = await access(req, req.params.id, true);
  if (!project) return fail(res, 403, 'No tienes permiso para sincronizar este evento.');
  const clientId = String(req.body.clientId || '').trim().slice(0, 120);
  const operationId = String(req.body.operationId || '').trim().slice(0, 160);
  const baseVersion = Number.parseInt(req.body.baseVersion, 10);
  const payload = req.body.payload;
  if (clientId.length < 8 || operationId.length < 8 || !Number.isSafeInteger(baseVersion) || baseVersion < 1 || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail(res, 400, 'La operación de sincronización no es válida.');
  }
  const { data, error } = await supabase.rpc('tshow_apply_sync_operation', {
    target_project: project.id,
    target_actor: req.user.id,
    target_client: clientId,
    target_operation: operationId,
    target_base_version: baseVersion,
    target_payload: payload
  });
  if (error) return fail(res, error.message.includes('PROJECT_NOT_FOUND') ? 404 : 400, error.message);
  if (data.status === 'conflict') return fail(res, 409, 'Hay cambios más recientes. Revisa el conflicto antes de reemplazar el evento.', { conflict: data });
  res.json({ success: true, data });
});

router.get('/projects/:id/sync/conflicts', requireSupabaseAuth, async (req, res) => {
  if (!await access(req, req.params.id, true)) return fail(res, 403, 'No tienes permiso para revisar conflictos.');
  const { data, error } = await supabase.from('tshow_sync_conflicts').select('*')
    .eq('project_id', req.params.id).eq('status', 'open').order('created_at', { ascending: false });
  return error ? fail(res, 500, error.message) : res.json({ success: true, data: data || [] });
});

router.post('/projects/:id/sync/conflicts/:conflictId/resolve', requireSupabaseAuth, async (req, res) => {
  const project = await access(req, req.params.id, true);
  if (!project) return fail(res, 403, 'No tienes permiso para resolver conflictos.');
  if (!['server','client','manual'].includes(req.body.resolution)) return fail(res, 400, 'Resolución no válida.');
  const { data: conflict } = await supabase.from('tshow_sync_conflicts').select('*')
    .eq('id', req.params.conflictId).eq('project_id', req.params.id).eq('status', 'open').maybeSingle();
  if (!conflict) return fail(res, 404, 'Conflicto no encontrado.');
  let selectedPayload = project.payload;
  if (req.body.resolution === 'client') selectedPayload = conflict.client_snapshot;
  if (req.body.resolution === 'manual') selectedPayload = req.body.payload;
  if (!selectedPayload || typeof selectedPayload !== 'object' || Array.isArray(selectedPayload)) return fail(res, 400, 'El documento resuelto no es válido.');
  if (req.body.resolution !== 'server') {
    const updated = await supabase.from('tshow_projects').update({ payload: selectedPayload, event_name: selectedPayload.eventName || project.event_name })
      .eq('id', project.id).eq('document_version', project.document_version).select('document_version').maybeSingle();
    if (updated.error || !updated.data) return fail(res, 409, 'El evento volvió a cambiar. Recarga el conflicto.');
  }
  const { data, error } = await supabase.from('tshow_sync_conflicts').update({
    status: 'resolved', resolution: req.body.resolution, resolved_by: req.user.id, resolved_at: new Date().toISOString()
  }).eq('id', conflict.id).select().single();
  return error ? fail(res, 400, error.message) : res.json({ success: true, data });
});

module.exports = router;
