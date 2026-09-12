const express = require('express');
const { supabase } = require('../supabaseClient');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');
const { featureEnabled } = require('../services/features');
const { createClient, configuration } = require('../services/ticketera');
const ticketera = createClient();

const router = express.Router();
const ticketeraConfigured = () => Boolean(
  String(process.env.TICKETERA_API_URL || '').trim() &&
  String(process.env.TICKETERA_API_KEY || '').trim()
);
const fail = (res, status, code, message) => res.status(status).json({ success: false, code, message, requestId: res.req.requestId });

async function projectAccess(req, projectId) {
  const { data: project, error } = await supabase.from('tshow_projects')
    .select('id,event_name,owner_id,deleted_at')
    .eq('id', projectId).maybeSingle();
  if (error || !project || project.deleted_at) return null;
  if (req.user.profile?.role === 'platform_admin') return { project, role: 'admin' };
  if (project.owner_id === req.user.id) return { project, role: 'owner' };
  const { data: member } = await supabase.from('tshow_project_members')
    .select('role').eq('project_id', projectId).eq('user_id', req.user.id).maybeSingle();
  return member ? { project, role: member.role } : null;
}

async function integrationAllowed(req, project) {
  return featureEnabled(project.owner_id, 'integrations', req.user.profile?.role);
}

router.get('/integrations/ticketera/events', requireSupabaseAuth, async (req, res) => {
  try {
    if (!await featureEnabled(req.user.id, 'integrations', req.user.profile?.role)) {
      return fail(res, 403, 'FEATURE_DISABLED', 'La integración con Ticketera no está habilitada para esta cuenta.');
    }
    const data = await ticketera.events(req.requestId);
    res.json({ success: true, data: data.events });
  } catch (error) {
    fail(res, error.status || 502, error.code || 'TICKETERA_UNAVAILABLE', error.status ? error.message : 'No pudimos consultar Ticketera.');
  }
});

router.get('/projects/:id/integrations/ticketera', requireSupabaseAuth, async (req, res) => {
  const access = await projectAccess(req, req.params.id);
  if (!access) return fail(res, 403, 'PROJECT_FORBIDDEN', 'No tienes acceso a este proyecto.');
  if (!await integrationAllowed(req, access.project)) return fail(res, 403, 'FEATURE_DISABLED', 'La integración con Ticketera no está habilitada para esta cuenta.');
  if (ticketeraConfigured()) {
    try { configuration(); } catch (error) { return fail(res, error.status, error.code, error.message); }
  }
  const { data, error } = await supabase.from('tshow_ticketera_connections').select('*').eq('project_id', req.params.id).maybeSingle();
  if (error) return fail(res, 500, 'CONNECTION_READ_FAILED', 'No pudimos consultar la conexión con Ticketera.');
  res.json({ success: true, data: data || null, configured: ticketeraConfigured(), manageable: ['owner', 'admin'].includes(access.role) });
});

router.put('/projects/:id/integrations/ticketera', requireSupabaseAuth, async (req, res) => {
  const access = await projectAccess(req, req.params.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return fail(res, 403, 'PROJECT_FORBIDDEN', 'Solo el propietario puede conectar Ticketera.');
  if (!await integrationAllowed(req, access.project)) return fail(res, 403, 'FEATURE_DISABLED', 'La integración con Ticketera no está habilitada para esta cuenta.');
  const externalEventId = String(req.body.externalEventId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(externalEventId)) return fail(res, 400, 'INVALID_EXTERNAL_EVENT', 'Selecciona un evento válido de Ticketera.');
  let externalEvent;
  try {
    const result = await ticketera.events(req.requestId);
    externalEvent = (result.events || []).find(event => String(event.id) === externalEventId);
  } catch (error) {
    return fail(res, error.status || 502, error.code || 'TICKETERA_UNAVAILABLE', error.status ? error.message : 'No pudimos consultar Ticketera.');
  }
  if (!externalEvent) return fail(res, 404, 'EXTERNAL_EVENT_NOT_FOUND', 'El evento ya no existe en Ticketera.');
  const { data: existingConnection, error: connectionLookupError } = await supabase
    .from('tshow_ticketera_connections')
    .select('project_id')
    .eq('external_event_id', externalEventId)
    .neq('project_id', req.params.id)
    .maybeSingle();
  if (connectionLookupError) {
    return fail(res, 500, 'CONNECTION_READ_FAILED', 'No pudimos verificar la disponibilidad del evento de Ticketera.');
  }
  if (existingConnection) {
    return fail(res, 409, 'TICKETERA_EVENT_ALREADY_CONNECTED', 'Este evento de Ticketera ya está conectado a otro proyecto de T-Show.');
  }
  const row = {
    project_id: req.params.id,
    external_event_id: externalEventId,
    external_event_name: String(externalEvent.name || '').slice(0, 255),
    status: 'active', last_error: null, created_by: req.user.id, updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from('tshow_ticketera_connections').upsert(row, { onConflict: 'project_id' }).select().single();
  if (error?.code === '23505') {
    return fail(res, 409, 'TICKETERA_EVENT_ALREADY_CONNECTED', 'Este evento de Ticketera ya está conectado a otro proyecto de T-Show.');
  }
  if (error) return fail(res, 500, 'CONNECTION_SAVE_FAILED', 'No pudimos guardar la conexión con Ticketera.');
  await supabase.from('tshow_audit_log').insert({ project_id: req.params.id, actor_id: req.user.id, action: 'integration.ticketera.connected', metadata: { externalEventId } });
  res.json({ success: true, data, message: `Ticketera quedó conectada con ${externalEvent.name}.` });
});

router.delete('/projects/:id/integrations/ticketera', requireSupabaseAuth, async (req, res) => {
  const access = await projectAccess(req, req.params.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return fail(res, 403, 'PROJECT_FORBIDDEN', 'Solo el propietario puede desconectar Ticketera.');
  const { error } = await supabase.from('tshow_ticketera_connections').delete().eq('project_id', req.params.id);
  if (error) return fail(res, 500, 'CONNECTION_DELETE_FAILED', 'No pudimos desconectar Ticketera.');
  await supabase.from('tshow_audit_log').insert({ project_id: req.params.id, actor_id: req.user.id, action: 'integration.ticketera.disconnected', metadata: {} });
  res.json({ success: true, message: 'Ticketera fue desconectada de este proyecto.' });
});

router.get('/projects/:id/metrics/ticketera', requireSupabaseAuth, async (req, res) => {
  const access = await projectAccess(req, req.params.id);
  if (!access) return fail(res, 403, 'PROJECT_FORBIDDEN', 'No tienes acceso a este proyecto.');
  if (!await integrationAllowed(req, access.project)) return fail(res, 403, 'FEATURE_DISABLED', 'La integración con Ticketera no está habilitada para esta cuenta.');
  const { data: connection, error } = await supabase.from('tshow_ticketera_connections').select('*').eq('project_id', req.params.id).maybeSingle();
  if (error) return fail(res, 500, 'CONNECTION_READ_FAILED', 'No pudimos consultar la conexión con Ticketera.');
  if (!connection) return fail(res, 404, 'TICKETERA_NOT_CONNECTED', 'Conecta este proyecto con un evento de Ticketera para ver sus métricas.');
  try {
    const result = await ticketera.metrics(connection.external_event_id, req.requestId);
    const syncedAt = new Date().toISOString();
    const { error: syncError } = await supabase.from('tshow_ticketera_connections').update({ status: 'active', last_synced_at: syncedAt, last_error: null, updated_at: syncedAt }).eq('id', connection.id);
    if (syncError) return fail(res, 500, 'CONNECTION_SAVE_FAILED', 'Las cifras llegaron, pero no pudimos guardar el estado de sincronización. Vuelve a intentar.');
    res.json({ success: true, data: result.metrics, connection: { ...connection, status: 'active', last_synced_at: syncedAt }, manageable: ['owner', 'admin'].includes(access.role) });
  } catch (requestError) {
    await supabase.from('tshow_ticketera_connections').update({ status: 'error', last_error: requestError.message.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', connection.id);
    fail(res, requestError.status || 502, requestError.code || 'TICKETERA_UNAVAILABLE', requestError.status ? requestError.message : 'No pudimos consultar Ticketera.');
  }
});

module.exports = router;
