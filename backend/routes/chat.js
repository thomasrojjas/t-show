const express = require('express');
const { supabase } = require('../supabaseClient');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');

const router = express.Router();
const sendWindows = new Map();
const MAX_BODY_LENGTH = 2000;
const PAGE_SIZE = 50;
const CHAT_TIMEOUT_MS = 15000;

const withTimeout = (promise, message = 'El servicio de chat tardó demasiado.') => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => {
    const error = new Error(message);
    error.code = 'CHAT_TIMEOUT';
    error.status = 504;
    reject(error);
  }, CHAT_TIMEOUT_MS))
]);

function errorResponse(res, req, status, code, message, extra = {}) {
  return res.status(status).json({ success: false, code, message, requestId: req.requestId || undefined, ...extra });
}

function displayName(profile, email) {
  const name = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
  return name || String(email || 'Usuario').split('@')[0].slice(0, 180) || 'Usuario';
}

function eventData(project, permission, unreadCount, lastSequence, lastReadSequence) {
  const payload = project.payload && typeof project.payload === 'object' ? project.payload : {};
  return {
    id: project.id,
    name: project.event_name || 'Evento sin nombre',
    eventDate: payload.eventDate || '',
    timeZone: payload.timeZone || payload.timezone || payload.zone || 'America/Santiago',
    permission,
    canWrite: ['owner', 'editor'].includes(permission),
    unreadCount,
    lastSequence,
    lastReadSequence
  };
}

async function chatAccess(projectId, userId, edit = false) {
  const { data: project, error: projectError } = await supabase
    .from('tshow_projects')
    .select('id,event_name,payload,owner_id,deleted_at')
    .eq('id', projectId)
    .maybeSingle();
  if (projectError || !project || project.deleted_at) return null;
  if (project.owner_id === userId) return { project, permission: 'owner' };
  const { data: member, error: memberError } = await supabase
    .from('tshow_project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (memberError || !member || (edit && member.role !== 'editor')) return null;
  return { project, permission: member.role };
}

async function accessibleProjects(userId) {
  const [ownedResult, memberResult] = await Promise.all([
    supabase.from('tshow_projects').select('id').eq('owner_id', userId).is('deleted_at', null),
    supabase.from('tshow_project_members').select('project_id,role').eq('user_id', userId)
  ]);
  if (ownedResult.error) throw ownedResult.error;
  if (memberResult.error) throw memberResult.error;
  const roles = new Map((ownedResult.data || []).map(row => [row.id, 'owner']));
  (memberResult.data || []).forEach(row => {
    if (!roles.has(row.project_id)) roles.set(row.project_id, row.role);
  });
  const projects = await Promise.all([...roles.keys()].map(async id => {
    const { data, error } = await supabase.from('tshow_projects')
      .select('id,event_name,payload,owner_id,deleted_at')
      .eq('id', id).is('deleted_at', null).maybeSingle();
    if (error || !data) return null;
    return { project: data, permission: roles.get(id) };
  }));
  return projects.filter(Boolean);
}

async function projectSummary(userId, access) {
  const { project, permission } = access;
  const [latestResult, readResult] = await Promise.all([
    supabase.from('tshow_chat_messages').select('sequence,created_at').eq('project_id', project.id).order('sequence', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('tshow_chat_reads').select('last_read_sequence').eq('project_id', project.id).eq('user_id', userId).maybeSingle()
  ]);
  if (latestResult.error) throw latestResult.error;
  if (readResult.error) throw readResult.error;
  const latest = latestResult.data;
  const lastSequence = Number(latest?.sequence || 0);
  const hasReadCursor = Boolean(readResult.data);
  const lastReadSequence = hasReadCursor ? Number(readResult.data.last_read_sequence || 0) : lastSequence;
  if (!hasReadCursor && lastSequence > 0) {
    await supabase.from('tshow_chat_reads').upsert({ project_id: project.id, user_id: userId, last_read_sequence: lastSequence, updated_at: new Date().toISOString() }, { onConflict: 'project_id,user_id' });
  }
  let unreadCount = 0;
  if (hasReadCursor && lastSequence > lastReadSequence) {
    const unread = await supabase.from('tshow_chat_messages').select('id', { count: 'exact', head: true })
      .eq('project_id', project.id).gt('sequence', lastReadSequence).neq('sender_id', userId);
    if (unread.error) throw unread.error;
    unreadCount = unread.count || 0;
  }
  return eventData(project, permission, unreadCount, lastSequence, lastReadSequence);
}

function rateLimit(userId, projectId) {
  const key = `${userId}:${projectId}`;
  const now = Date.now();
  const entry = sendWindows.get(key) || { startedAt: now, count: 0 };
  if (now - entry.startedAt >= 60000) { entry.startedAt = now; entry.count = 0; }
  if (entry.count >= 30) {
    sendWindows.set(key, entry);
    return Math.max(1, Math.ceil((60000 - (now - entry.startedAt)) / 1000));
  }
  entry.count += 1;
  sendWindows.set(key, entry);
  return 0;
}

function normalizeMessage(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    sequence: Number(row.sequence),
    senderId: row.sender_id,
    senderName: row.sender_name,
    body: row.body,
    block: row.block_key ? { key: row.block_key, number: row.block_number, title: row.block_title || '' } : null,
    createdAt: row.created_at,
    clientMessageId: row.client_message_id
  };
}

function normalizeBlockReference(project, block) {
  if (!block) return null;
  const blocks = Array.isArray(project.payload?.blocks) ? project.payload.blocks : [];
  const requestedKey = String(block.key || '').trim();
  const requestedNumber = block.number == null ? null : Number(block.number);
  const found = blocks.find(item => String(item.id || item.key || '').trim() === requestedKey || (requestedNumber !== null && Number(item.num || item.number) === requestedNumber));
  if (!found) return undefined;
  return {
    key: String(found.id || found.key || requestedKey).slice(0, 180),
    number: Number(found.num || found.number || requestedNumber) || null,
    title: String(found.title || found.name || block.title || '').trim().slice(0, 180)
  };
}

router.get('/chat/summary', requireSupabaseAuth, async (req, res) => {
  try {
    const projects = await withTimeout(accessibleProjects(req.user.id));
    const events = await withTimeout(Promise.all(projects.map(access => projectSummary(req.user.id, access))));
    const preference = await supabase.from('tshow_chat_preferences').select('sound_enabled').eq('user_id', req.user.id).maybeSingle();
    if (preference.error) throw preference.error;
    return res.json({ success: true, data: {
      events: events.sort((a, b) => a.name.localeCompare(b.name, 'es')),
      unreadTotal: events.reduce((total, event) => total + event.unreadCount, 0),
      soundEnabled: Boolean(preference.data?.sound_enabled)
    }});
  } catch (error) {
    return errorResponse(res, req, error.status || 503, error.code || 'CHAT_SUMMARY_UNAVAILABLE', 'No pudimos cargar las conversaciones. Intenta nuevamente.');
  }
});

router.get('/projects/:id/chat/messages', requireSupabaseAuth, async (req, res) => {
  const access = await chatAccess(req.params.id, req.user.id);
  if (!access) return errorResponse(res, req, 403, 'CHAT_FORBIDDEN', 'No tienes acceso al chat de este evento.');
  const before = req.query.beforeSequence ? Number(req.query.beforeSequence) : null;
  const since = req.query.sinceSequence ? Number(req.query.sinceSequence) : null;
  if ((before !== null && !Number.isSafeInteger(before)) || (since !== null && !Number.isSafeInteger(since))) return errorResponse(res, req, 400, 'CHAT_INVALID_CURSOR', 'El cursor de mensajes no es válido.');
  try {
    let query = supabase.from('tshow_chat_messages').select('*').eq('project_id', req.params.id).order('sequence', { ascending: false }).limit(PAGE_SIZE);
    if (before !== null) query = query.lt('sequence', before);
    if (since !== null) query = query.gt('sequence', since);
    const { data, error } = await withTimeout(query);
    if (error) throw error;
    return res.json({ success: true, data: {
      messages: (data || []).sort((a, b) => Number(a.sequence) - Number(b.sequence)).map(normalizeMessage),
      hasMore: before !== null && (data || []).length === PAGE_SIZE,
      event: eventData(access.project, access.permission, 0, 0, 0)
    }});
  } catch (error) {
    return errorResponse(res, req, error.status || 503, error.code || 'CHAT_MESSAGES_UNAVAILABLE', 'No pudimos cargar los mensajes.');
  }
});

router.post('/projects/:id/chat/messages', requireSupabaseAuth, async (req, res) => {
  const access = await chatAccess(req.params.id, req.user.id, true);
  if (!access) return errorResponse(res, req, 403, 'CHAT_WRITE_FORBIDDEN', 'Solo propietarios y directores pueden escribir en este chat.');
  const retryAfterSeconds = rateLimit(req.user.id, req.params.id);
  if (retryAfterSeconds) return errorResponse(res, req, 429, 'CHAT_RATE_LIMITED', 'Has enviado muchos mensajes. Espera un momento antes de intentar nuevamente.', { retryAfterSeconds });
  const body = typeof req.body?.body === 'string' ? req.body.body : '';
  const clientMessageId = String(req.body?.clientMessageId || '');
  const block = req.body?.block && typeof req.body.block === 'object' ? req.body.block : null;
  if (!body.trim() || body.length > MAX_BODY_LENGTH) return errorResponse(res, req, 400, 'CHAT_INVALID_MESSAGE', `El mensaje debe tener entre 1 y ${MAX_BODY_LENGTH} caracteres.`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientMessageId)) return errorResponse(res, req, 400, 'CHAT_INVALID_MESSAGE_ID', 'No pudimos identificar este envío. Intenta nuevamente.');
  if (block && (!String(block.key || '').trim() || (block.number != null && (!Number.isInteger(Number(block.number)) || Number(block.number) < 1)))) return errorResponse(res, req, 400, 'CHAT_INVALID_BLOCK', 'La referencia del bloque no es válida.');
  const blockReference = normalizeBlockReference(access.project, block);
  if (block && blockReference === undefined) return errorResponse(res, req, 400, 'CHAT_INVALID_BLOCK', 'El bloque asociado ya no pertenece a este evento.');
  try {
    const existing = await supabase.from('tshow_chat_messages').select('*').eq('sender_id', req.user.id).eq('client_message_id', clientMessageId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return res.status(200).json({ success: true, data: normalizeMessage(existing.data), deduplicated: true });
    const sequenceResult = await withTimeout(supabase.rpc('tshow_chat_next_sequence', { target_project: req.params.id }));
    if (sequenceResult.error || !sequenceResult.data) throw sequenceResult.error || Object.assign(new Error('No se pudo reservar el mensaje.'), { code: 'CHAT_SEQUENCE_UNAVAILABLE' });
    const row = {
      project_id: req.params.id,
      sequence: Number(sequenceResult.data),
      sender_id: req.user.id,
      sender_name: displayName(req.user.profile, req.user.email),
      body,
      block_key: blockReference?.key || null,
      block_number: blockReference?.number || null,
      block_title: blockReference?.title || null,
      client_message_id: clientMessageId
    };
    const inserted = await withTimeout(supabase.from('tshow_chat_messages').insert(row).select('*').single());
    if (inserted.error) {
      if (inserted.error.code === '23505') {
        const duplicate = await supabase.from('tshow_chat_messages').select('*').eq('sender_id', req.user.id).eq('client_message_id', clientMessageId).maybeSingle();
        if (duplicate.data) return res.status(200).json({ success: true, data: normalizeMessage(duplicate.data), deduplicated: true });
      }
      throw inserted.error;
    }
    return res.status(201).json({ success: true, data: normalizeMessage(inserted.data) });
  } catch (error) {
    if (error.code === 'CHAT_TIMEOUT') return errorResponse(res, req, 504, 'CHAT_PENDING', 'El envío está tardando. Revisa el estado antes de repetirlo.');
    return errorResponse(res, req, 503, 'CHAT_SEND_UNAVAILABLE', 'No pudimos enviar el mensaje. Conservamos tu borrador para reintentarlo.');
  }
});

router.put('/projects/:id/chat/read', requireSupabaseAuth, async (req, res) => {
  const access = await chatAccess(req.params.id, req.user.id);
  if (!access) return errorResponse(res, req, 403, 'CHAT_FORBIDDEN', 'No tienes acceso al chat de este evento.');
  const sequence = Number(req.body?.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 0) return errorResponse(res, req, 400, 'CHAT_INVALID_CURSOR', 'El cursor de lectura no es válido.');
  try {
    const current = await supabase.from('tshow_chat_reads').select('last_read_sequence').eq('project_id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    if (current.error) throw current.error;
    const next = Math.max(Number(current.data?.last_read_sequence || 0), sequence);
    const result = await supabase.from('tshow_chat_reads').upsert({ project_id: req.params.id, user_id: req.user.id, last_read_sequence: next, updated_at: new Date().toISOString() }, { onConflict: 'project_id,user_id' }).select().single();
    if (result.error) throw result.error;
    return res.json({ success: true, data: { projectId: req.params.id, lastReadSequence: next } });
  } catch (_) {
    return errorResponse(res, req, 503, 'CHAT_READ_UNAVAILABLE', 'No pudimos actualizar los mensajes leídos.');
  }
});

router.patch('/chat/preferences', requireSupabaseAuth, async (req, res) => {
  if (typeof req.body?.soundEnabled !== 'boolean') return errorResponse(res, req, 400, 'CHAT_INVALID_PREFERENCE', 'La preferencia de sonido no es válida.');
  try {
    const result = await supabase.from('tshow_chat_preferences').upsert({ user_id: req.user.id, sound_enabled: req.body.soundEnabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).select().single();
    if (result.error) throw result.error;
    return res.json({ success: true, data: { soundEnabled: Boolean(result.data.sound_enabled) } });
  } catch (_) {
    return errorResponse(res, req, 503, 'CHAT_PREFERENCE_UNAVAILABLE', 'No pudimos guardar la preferencia de sonido.');
  }
});

module.exports = router;
