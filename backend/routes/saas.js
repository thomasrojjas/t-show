const crypto = require('crypto');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { supabase } = require('../supabaseClient');
const { requireAuthenticatedUser, requireSupabaseAuth, requirePlatformAdmin } = require('../middleware/supabaseAuth');
const { deleteObject, duplicateProjectCover } = require('../r2');
const { getEntitlement, PLAN_LIMITS } = require('../services/entitlements');
const { resolveWritableOrganization } = require('../services/organizations');

const router = express.Router();
const passwordResetRequests = new Map();
const PASSWORD_RESET_COOLDOWN_MS = 15 * 60 * 1000;
const publicAuthClient = process.env.SUPABASE_ANON_KEY ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
const normalizeRut = rut => {
  const compact = String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
  return compact.length >= 8 && compact.length <= 9 ? `${compact.slice(0, -1)}-${compact.slice(-1)}` : '';
};
const validRut = rut => {
  const normalized = normalizeRut(rut);
  if (!/^[0-9]{7,8}-[0-9K]$/.test(normalized)) return false;
  const [digits, verifier] = normalized.split('-');
  let sum = 0; let multiplier = 2;
  for (let index = digits.length - 1; index >= 0; index -= 1) { sum += Number(digits[index]) * multiplier; multiplier = multiplier === 7 ? 2 : multiplier + 1; }
  const expected = 11 - (sum % 11);
  return verifier === (expected === 11 ? '0' : expected === 10 ? 'K' : String(expected));
};
const validPhone = phone => /^\+569[0-9]{8}$/.test(String(phone || '').replace(/[\s()-]/g, ''));
const cleanPayload = body => ({ ...body, eventName: String(body.eventName || '').trim() });
const projectTypes = new Set(['concert', 'festival', 'corporate', 'ceremony', 'broadcast', 'other']);
const accentColors = new Set(['blue', 'violet', 'cyan', 'green', 'amber', 'rose']);
const cleanIdentity = body => {
  const eventName = String(body.eventName || '').trim();
  const projectType = projectTypes.has(body.projectType) ? body.projectType : 'other';
  const eventDate = String(body.eventDate || '').trim();
  const location = String(body.location || '').trim();
  const accentColor = accentColors.has(body.accentColor) ? body.accentColor : 'blue';
  if (!eventName || eventName.length > 180) throw new Error('El nombre del proyecto es inválido.');
  if (eventDate && (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || Number.isNaN(Date.parse(`${eventDate}T00:00:00Z`)))) throw new Error('La fecha del evento es inválida.');
  if (location.length > 160) throw new Error('La ubicación no puede superar 160 caracteres.');
  return { eventName, projectType, eventDate, location, accentColor };
};

async function access(projectId, userId, edit = false) {
  const { data: project } = await supabase.from('tshow_projects').select('*').eq('id', projectId).maybeSingle();
  if (!project || project.deleted_at) return null;
  if (project.owner_id === userId) return { project, role: 'owner' };
  const { data: member } = await supabase.from('tshow_project_members').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle();
  if (!member || (edit && member.role !== 'editor')) return null;
  return { project, role: member.role };
}
async function accessForRequest(projectId, req, edit = false) {
  if (req.user?.profile?.role === 'platform_admin') {
    const { data: project } = await supabase.from('tshow_projects').select('*').eq('id', projectId).is('deleted_at', null).maybeSingle();
    return project ? { project, role: 'admin' } : null;
  }
  return access(projectId, req.user.id, edit);
}
async function audit(projectId, actorId, action, metadata = {}) {
  await supabase.from('tshow_audit_log').insert({ project_id: projectId, actor_id: actorId, action, metadata });
}

router.post('/profile', requireAuthenticatedUser, async (req, res) => {
  const { firstName, lastName, rut, phone } = req.body;
  const email = req.user.email;
  const normalizedRut = normalizeRut(rut);
  if (!firstName?.trim() || !lastName?.trim() || !validRut(normalizedRut) || !validPhone(phone)) return res.status(400).json({ success: false, message: 'Datos de perfil inválidos.' });
  const row = { id: req.user.id, first_name: firstName.trim(), last_name: lastName.trim(), rut: normalizedRut, phone: String(phone).replace(/[\s()-]/g, ''), email: email.toLowerCase() };
  const { data, error } = await supabase.from('profiles').upsert(row).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 400).json({ success: false, message: error.code === '23505' ? 'El RUT o correo ya está registrado.' : error.message });
  res.json({ success: true, data });
});

router.get('/me', requireSupabaseAuth, (req, res) => res.json({ success: true, data: req.user.profile }));

router.get('/projects', requireSupabaseAuth, async (req, res) => {
  const id = req.user.id;
  const isPlatformAdmin = req.user.profile?.role === 'platform_admin';
  const { data: owned, error } = await supabase.from('tshow_projects').select('*').is('deleted_at', null).order('updated_at', { ascending: false }).then(result => isPlatformAdmin ? result : { ...result, data: (result.data || []).filter(project => project.owner_id === id) });
  if (error) return res.status(500).json({ success: false, message: error.message });
  const { count: ownedCount } = await supabase.from('tshow_projects').select('id', { count: 'exact', head: true }).eq('owner_id', id).is('deleted_at', null);
  let entitlement;
  try { entitlement = await getEntitlement(id, req.user.profile?.role); } catch (entitlementError) { return res.status(500).json({ success: false, message: 'No se pudo calcular el cupo de proyectos.' }); }
  const meta = { ownedCount: ownedCount || 0, limit: entitlement.limit, remaining: entitlement.remaining, plan: entitlement.plan, subscriptionStatus: entitlement.status };
  if (isPlatformAdmin) return res.json({ success: true, data: (owned || []).map(project => ({ ...project, member_role: project.owner_id === id ? 'owner' : 'admin' })), meta });
  const { data: memberships } = await supabase.from('tshow_project_members').select('project_id,role,tshow_projects(*)').eq('user_id', id);
  const projects = [...owned, ...(memberships || []).map(m => ({ ...m.tshow_projects, member_role: m.role })).filter(project => project && !project.deleted_at)];
  res.json({ success: true, data: projects, meta });
});

router.post('/projects', requireSupabaseAuth, async (req, res) => {
  let identity;
  try { identity = cleanIdentity(req.body); } catch (error) { return res.status(400).json({ success: false, message: error.message }); }
  const payload = cleanPayload({ ...req.body, ...identity });
  let organizationId;
  try { organizationId = await resolveWritableOrganization(req.user.profile, req.body.organizationId); }
  catch (error) { return res.status(error.status || 500).json({ success: false, message: error.message }); }
  const { data, error } = await supabase.from('tshow_projects').insert({ owner_id: req.user.id, organization_id: organizationId, event_name: payload.eventName, payload }).select().single();
  if (error) return res.status(error.code === 'P0001' || error.code === '23514' ? 409 : 400).json({ success: false, message: error.message });
  await audit(data.id, req.user.id, 'project.created');
  res.status(201).json({ success: true, data });
});

router.post('/projects/:id/duplicate', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req);
  if (!granted || !['owner', 'admin'].includes(granted.role)) return res.status(403).json({ success: false, message: 'Solo el propietario puede duplicar este proyecto.' });
  const payload = { ...granted.project.payload, eventName: `${granted.project.event_name} — Copia` };
  const { data, error } = await supabase.from('tshow_projects').insert({ owner_id: req.user.id, organization_id: granted.project.organization_id || req.user.profile.default_organization_id, event_name: payload.eventName, payload }).select().single();
  if (error) return res.status(error.code === 'P0001' || error.code === '23514' ? 409 : 400).json({ success: false, message: error.message });
  if (granted.project.cover_key) {
    try {
      const coverKey = await duplicateProjectCover(granted.project.cover_key, data.id);
      if (coverKey) { data.cover_key = coverKey; await supabase.from('tshow_projects').update({ cover_key: coverKey }).eq('id', data.id); }
    } catch (coverError) { console.error('Project cover duplication failed:', coverError.message); }
  }
  await audit(data.id, req.user.id, 'project.duplicated', { sourceProjectId: req.params.id });
  res.status(201).json({ success: true, data });
});

router.get('/projects/:id', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req);
  if (!granted) return res.status(404).json({ success: false, message: 'Proyecto no encontrado.' });
  res.json({ success: true, data: { ...granted.project, payload: granted.project.payload, permission: granted.role } });
});

router.patch('/projects/:id', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req, true);
  if (!granted) return res.status(403).json({ success: false, message: 'No puedes editar este proyecto.' });
  const payload = cleanPayload(req.body);
  if (!payload.eventName) return res.status(400).json({ success: false, message: 'El nombre del evento es requerido.' });
  const expectedVersion = req.body.documentVersion === undefined ? null : Number(req.body.documentVersion);
  let query = supabase.from('tshow_projects').update({ event_name: payload.eventName, payload }).eq('id', req.params.id);
  if (expectedVersion !== null && Number.isSafeInteger(expectedVersion)) query = query.eq('document_version', expectedVersion);
  const { data, error } = await query.select().maybeSingle();
  if (error) return res.status(400).json({ success: false, message: error.message });
  if (!data) return res.status(409).json({ success: false, code: 'VERSION_CONFLICT', message: 'El evento cambió en otro dispositivo. Recarga para revisar los cambios antes de guardar.' });
  await audit(data.id, req.user.id, 'project.updated');
  res.json({ success: true, data });
});

router.patch('/projects/:id/identity', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req);
  if (!granted || !['owner', 'admin'].includes(granted.role)) return res.status(403).json({ success: false, message: 'Solo el propietario puede editar la identidad.' });
  let identity;
  try { identity = cleanIdentity(req.body); } catch (error) { return res.status(400).json({ success: false, message: error.message }); }
  const coverKey = req.body.coverKey === null ? null : String(req.body.coverKey || granted.project.cover_key || '');
  if (coverKey && !coverKey.startsWith(`projects/${req.params.id}/`)) return res.status(400).json({ success: false, message: 'La portada no pertenece al proyecto.' });
  const payload = { ...(granted.project.payload || {}), ...identity };
  const previousCover = granted.project.cover_key;
  const { data, error } = await supabase.from('tshow_projects').update({ event_name: identity.eventName, payload, cover_key: coverKey || null }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ success: false, message: error.message });
  if (previousCover && previousCover !== coverKey) deleteObject(previousCover).catch(storageError => console.error('Old project cover cleanup failed:', storageError.message));
  await audit(data.id, req.user.id, 'project.identity_updated');
  res.json({ success: true, data });
});

router.delete('/projects/:id', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req, true);
  if (!granted || !['owner', 'admin'].includes(granted.role)) return res.status(403).json({ success: false, message: 'Solo el propietario puede eliminarlo.' });
  await supabase.from('tshow_projects').update({ deleted_at: new Date().toISOString() }).eq('id', req.params.id);
  if (granted.project.cover_key) deleteObject(granted.project.cover_key).catch(storageError => console.error('Deleted project cover cleanup failed:', storageError.message));
  await audit(req.params.id, req.user.id, 'project.deleted');
  res.json({ success: true });
});

// Block notes and animator script live inside the existing project payload so
// legacy projects remain compatible without a second source of truth.
function notesFromProject(project) {
  return (Array.isArray(project.payload?.blocks) ? project.payload.blocks : []).map(block => ({
    blockId: block.id,
    title: block.title || '',
    type: block.type || '',
    start: block.start || block.startTime || null,
    duration: Number(block.duration || 0),
    notes: String(block.notes || ''),
    animator_script: String(block.animator_script || '')
  }));
}
router.get('/projects/:id/notes', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req);
  if (!granted) return res.status(403).json({ success: false, message: 'Sin acceso al proyecto.' });
  res.json({ success: true, data: notesFromProject(granted.project) });
});
router.get('/projects/:id/animator-script', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req);
  if (!granted) return res.status(403).json({ success: false, message: 'Sin acceso al proyecto.' });
  res.json({ success: true, data: notesFromProject(granted.project).filter(block => block.animator_script.trim()) });
});
router.patch('/projects/:id/blocks/:blockId/notes', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req, true);
  if (!granted) return res.status(403).json({ success: false, message: 'No tienes permiso para editar notas.' });
  const notes = String(req.body?.notes || '').trim();
  const animatorScript = String(req.body?.animator_script || '').trim();
  if (notes.length > 4000 || animatorScript.length > 8000) return res.status(400).json({ success: false, message: 'La nota o el guion supera el límite permitido.' });
  const payload = { ...(granted.project.payload || {}), blocks: Array.isArray(granted.project.payload?.blocks) ? granted.project.payload.blocks.map(block => block.id === req.params.blockId ? { ...block, notes, animator_script: animatorScript, notes_updated_at: new Date().toISOString(), notes_updated_by: req.user.id } : block) : [] };
  if (!payload.blocks.some(block => block.id === req.params.blockId)) return res.status(404).json({ success: false, message: 'Bloque no encontrado.' });
  const { data, error } = await supabase.from('tshow_projects').update({ payload }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ success: false, message: error.message });
  await audit(req.params.id, req.user.id, 'block.notes_updated', { blockId: req.params.blockId, hasNotes: Boolean(notes), hasAnimatorScript: Boolean(animatorScript) });
  res.json({ success: true, data: notesFromProject(data).find(block => block.blockId === req.params.blockId) });
});

router.get('/projects/:id/live', requireSupabaseAuth, async (req, res) => {
  if (!await accessForRequest(req.params.id, req)) return res.status(403).json({ success: false, message: 'Sin acceso al proyecto.' });
  const { data, error } = await supabase.from('tshow_live_sessions').select('*').eq('project_id', req.params.id).maybeSingle();
  if (error) return res.status(400).json({ success: false, message: error.message });
  res.json({ success: true, data: data?.state || null });
});
router.put('/projects/:id/live', requireSupabaseAuth, async (req, res) => {
  if (!await accessForRequest(req.params.id, req, true)) return res.status(403).json({ success: false, message: 'Sin permiso para operar en vivo.' });
  const state = req.body || {};
  const { data, error } = await supabase.from('tshow_live_sessions').upsert({ project_id: req.params.id, state, updated_by: req.user.id, last_updated: new Date().toISOString() }).select().single();
  if (error) return res.status(400).json({ success: false, message: error.message });
  await audit(req.params.id, req.user.id, 'live.updated');
  res.json({ success: true, data: data.state });
});

router.get('/projects/:id/members', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req);
  if (!granted) return res.status(403).json({ success: false, message: 'Sin acceso.' });
  // `tshow_project_members` has two foreign keys to profiles (user_id and
  // invited_by). Disambiguate the embedded relation so PostgREST does not
  // reject the request with "more than one relationship was found".
  const { data, error } = await supabase.from('tshow_project_members').select('role,created_at,profiles!tshow_project_members_user_id_fkey(id,first_name,last_name,email)').eq('project_id', req.params.id);
  if (error) return res.status(400).json({ success: false, message: error.message });
  const { data: owner } = await supabase.from('profiles').select('id,first_name,last_name,email').eq('id', granted.project.owner_id).maybeSingle();
  const ownerEntry = owner ? [{ role: 'owner', created_at: granted.project.created_at, profiles: owner }] : [];
  res.json({ success: true, data: [...ownerEntry, ...(data || [])], permission: granted.role });
});
router.get('/projects/:id/invitations', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req);
  if (!granted || granted.role !== 'admin' && granted.role !== 'owner') return res.status(403).json({ success: false, message: 'Sin permiso.' });
  const { data, error } = await supabase.from('tshow_invitations').select('id,email,role,status,delivery_status,expires_at,created_at').eq('project_id', req.params.id).order('created_at', { ascending: false });
  const invitations = (data || []).map(invite => ({ ...invite, effective_status: invite.status === 'pending' && new Date(invite.expires_at) < new Date() ? 'expired' : invite.status }));
  res.status(error ? 400 : 200).json({ success: !error, data: invitations, message: error?.message });
});
router.post('/projects/:id/invitations', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req, true);
  if (!granted || !['owner', 'admin'].includes(granted.role)) return res.status(403).json({ success: false, message: 'Solo el propietario puede invitar.' });
  const email = String(req.body.email || '').trim().toLowerCase(); const role = req.body.role === 'editor' ? 'editor' : 'viewer';
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ success: false, message: 'Correo inválido.' });
  const { data: memberProfile } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
  if (memberProfile) {
    const { data: existingMember } = await supabase.from('tshow_project_members').select('user_id').eq('project_id', req.params.id).eq('user_id', memberProfile.id).maybeSingle();
    if (existingMember) return res.status(409).json({ success: false, message: 'Esta persona ya pertenece al proyecto.' });
  }
  const { data: pendingInvite } = await supabase.from('tshow_invitations').select('id,expires_at').eq('project_id', req.params.id).ilike('email', email).eq('status', 'pending').gte('expires_at', new Date().toISOString()).maybeSingle();
  if (pendingInvite) return res.status(409).json({ success: false, message: 'Ya existe una invitación pendiente para este correo.' });
  const token = crypto.randomBytes(32).toString('base64url'); const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data, error } = await supabase.from('tshow_invitations').insert({ project_id: req.params.id, email, role, token_hash: tokenHash, invited_by: req.user.id }).select('id,email,role,expires_at,delivery_status').single();
  if (error) return res.status(400).json({ success: false, message: error.message });
  await audit(req.params.id, req.user.id, 'invitation.created', { email, role });
  // Email delivery is deliberately delegated to the configured transactional provider.
  let deliveryStatus = process.env.RESEND_API_KEY ? 'pending' : 'not_configured';
  if (process.env.RESEND_API_KEY) {
    const inviteUrl = `${process.env.FRONTEND_URL || process.env.CORS_ORIGIN}/invite.html?token=${encodeURIComponent(token)}`;
    const projectName = granted.project.event_name.replace(/[<>&"]/g, '');
    const html = `<!doctype html><html><body style="margin:0;background:#050609;color:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050609"><tr><td align="center" style="padding:48px 20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;border:1px solid #272a32;background:#080b13"><tr><td style="padding:36px"><p style="margin:0 0 52px;font-size:13px;font-weight:800;letter-spacing:.2em">T-SHOW</p><p style="margin:0 0 12px;color:#b8d7ff;font-size:11px;font-weight:700;letter-spacing:.16em">INVITACIÓN DE EQUIPO</p><h1 style="margin:0 0 20px;font-size:42px;line-height:1;letter-spacing:-.04em">Tu lugar en el show.</h1><p style="margin:0 0 30px;color:#b8bac2;font-size:16px;line-height:1.6">Te invitaron a colaborar en <strong style="color:#fff">${projectName}</strong> como ${role === 'editor' ? 'Director' : 'Observador'}.</p><a href="${inviteUrl}" style="display:inline-block;padding:15px 22px;background:#f5f5f2;color:#050609;text-decoration:none;font-weight:700">Aceptar invitación</a><p style="margin:30px 0 0;color:#777d89;font-size:12px;line-height:1.5">Este enlace vence en 7 días. Si no esperabas esta invitación, puedes ignorar el correo.</p></td></tr></table></td></tr></table></body></html>`;
    try {
      const emailResponse = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.RESEND_FROM || 'T-Show <noreply@t-show.site>', to: [email], subject: `Invitación a ${projectName} en T-Show`, html }) });
      deliveryStatus = emailResponse.ok ? 'sent' : 'failed';
      if (!emailResponse.ok) console.error('Invitation email failed:', await emailResponse.text());
    } catch (error) {
      deliveryStatus = 'failed';
      console.error('Invitation email failed:', error.message);
    }
  }
  await supabase.from('tshow_invitations').update({ delivery_status: deliveryStatus }).eq('id', data.id);
  res.status(201).json({ success: true, data: { ...data, delivery_status: deliveryStatus }, message: deliveryStatus === 'sent' ? `Invitación enviada a ${email}.` : deliveryStatus === 'not_configured' ? 'La invitación quedó guardada, pero el correo está pendiente de entrega.' : 'No pudimos enviar la invitación. Puedes intentarlo nuevamente.' });
});
router.patch('/projects/:id/members/:userId', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req);
  if (!granted || granted.role !== 'admin' && granted.role !== 'owner') return res.status(403).json({ success: false, message: 'Solo el propietario puede cambiar permisos.' });
  const role = req.body.role === 'editor' ? 'editor' : 'viewer';
  const { data, error } = await supabase.from('tshow_project_members').update({ role }).eq('project_id', req.params.id).eq('user_id', req.params.userId).select().single();
  if (!error) await audit(req.params.id, req.user.id, 'member.role_changed', { userId: req.params.userId, role });
  res.status(error ? 400 : 200).json({ success: !error, data, message: error?.message });
});
router.delete('/projects/:id/members/:userId', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req);
  if (!granted || granted.role !== 'admin' && granted.role !== 'owner') return res.status(403).json({ success: false, message: 'Solo el propietario puede remover miembros.' });
  const { error } = await supabase.from('tshow_project_members').delete().eq('project_id', req.params.id).eq('user_id', req.params.userId);
  if (!error) await audit(req.params.id, req.user.id, 'member.removed', { userId: req.params.userId });
  res.status(error ? 400 : 200).json({ success: !error, message: error?.message });
});
router.post('/projects/:id/members/:userId/password-reset', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req);
  if (!granted || !['owner', 'admin'].includes(granted.role)) return res.status(403).json({ success: false, message: 'No tienes permisos para solicitar restablecimientos.' });
  const { data: targetMember } = await supabase.from('tshow_project_members').select('user_id').eq('project_id', req.params.id).eq('user_id', req.params.userId).maybeSingle();
  if (!targetMember || targetMember.user_id === granted.project.owner_id) return res.status(404).json({ success: false, message: 'Miembro no encontrado.' });
  const key = `${req.params.id}:${req.params.userId}`;
  const lastRequest = passwordResetRequests.get(key) || 0;
  if (Date.now() - lastRequest < PASSWORD_RESET_COOLDOWN_MS) return res.status(429).json({ success: false, message: 'Debes esperar antes de solicitar otro restablecimiento.' });
  const { data: profile } = await supabase.from('profiles').select('email').eq('id', req.params.userId).maybeSingle();
  if (!profile?.email) return res.status(404).json({ success: false, message: 'El miembro no tiene un correo válido.' });
  const redirectTo = `${process.env.FRONTEND_URL || process.env.CORS_ORIGIN || ''}/reset-password.html`;
  if (!publicAuthClient) return res.status(503).json({ success: false, message: 'El servicio de restablecimiento no está configurado.' });
  const { error } = await publicAuthClient.auth.resetPasswordForEmail(profile.email, { redirectTo });
  if (error) return res.status(502).json({ success: false, message: 'No se pudo enviar la solicitud de restablecimiento.' });
  passwordResetRequests.set(key, Date.now());
  await audit(req.params.id, req.user.id, 'member.password_reset_requested', { userId: req.params.userId });
  res.json({ success: true, message: 'Solicitud enviada al correo del miembro.' });
});
router.delete('/invitations/:id', requireSupabaseAuth, async (req, res) => {
  const { data: invite } = await supabase.from('tshow_invitations').select('project_id').eq('id', req.params.id).maybeSingle();
  if (!invite) return res.status(404).json({ success: false, message: 'Invitación no encontrada.' });
  const granted = await accessForRequest(invite.project_id, req);
  if (!granted || granted.role !== 'admin' && granted.role !== 'owner') return res.status(403).json({ success: false, message: 'Sin permiso.' });
  const { error } = await supabase.from('tshow_invitations').update({ status: 'revoked' }).eq('id', req.params.id);
  if (!error) await audit(invite.project_id, req.user.id, 'invitation.revoked');
  res.status(error ? 400 : 200).json({ success: !error, message: error?.message });
});
router.get('/invitations/:token', async (req, res) => {
  const hash = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const { data: invite, error } = await supabase.from('tshow_invitations').select('email,role,expires_at,status,tshow_projects(event_name)').eq('token_hash', hash).maybeSingle();
  if (error || !invite || invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) return res.status(404).json({ success: false, message: 'La invitación no es válida o ya expiró.' });
  res.json({ success: true, data: { email: invite.email, role: invite.role, expires_at: invite.expires_at, project_name: invite.tshow_projects?.event_name || 'este proyecto' } });
});
router.post('/invitations/:token/accept', requireSupabaseAuth, async (req, res) => {
  const hash = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const { data: invite } = await supabase.from('tshow_invitations').select('*').eq('token_hash', hash).eq('status', 'pending').maybeSingle();
  if (!invite || new Date(invite.expires_at) < new Date() || invite.email !== req.user.email.toLowerCase()) return res.status(400).json({ success: false, message: 'Invitación inválida o expirada.' });
  await supabase.from('tshow_project_members').upsert({ project_id: invite.project_id, user_id: req.user.id, role: invite.role, invited_by: invite.invited_by });
  await supabase.from('tshow_invitations').update({ status: 'accepted', accepted_by: req.user.id, accepted_at: new Date().toISOString() }).eq('id', invite.id);
  await audit(invite.project_id, req.user.id, 'invitation.accepted');
  res.json({ success: true, projectId: invite.project_id });
});

router.get('/billing/plans', requireSupabaseAuth, async (req, res) => {
  const { data, error } = await supabase.from('tshow_plans').select('*').eq('active', true).order('interval');
  const plans = (data || []).map(plan => ({ ...plan, annual_original_clp: plan.interval === 'year' && plan.discount_percent ? Math.round(Number(plan.amount_clp) / (1 - Number(plan.discount_percent) / 100)) : null, annual_offer_clp: plan.interval === 'year' ? plan.amount_clp : null }));
  res.status(error ? 400 : 200).json({ success: !error, data: plans, message: error?.message });
});
router.get('/billing/subscription', requireSupabaseAuth, async (req, res) => {
  const { data, error } = await supabase.from('tshow_subscriptions').select('*,tshow_plans(*)').eq('account_id', req.user.id).maybeSingle();
  res.status(error ? 400 : 200).json({ success: !error, data, message: error?.message });
});
router.get('/admin/plans', requireSupabaseAuth, requirePlatformAdmin, async (req, res) => {
  const { data, error } = await supabase.from('tshow_plans').select('*').order('name').order('interval');
  res.status(error ? 400 : 200).json({ success: !error, data: data || [], message: error?.message });
});
async function updatePlan(req, res) {
  const { name, amount_clp, active, benefits, interval, project_limit, discount_percent } = req.body;
  const patch = { name, amount_clp, active, benefits, interval, project_limit, discount_percent };
  Object.keys(patch).forEach(key => patch[key] === undefined && delete patch[key]);
  const { data, error } = await supabase.from('tshow_plans').update(patch).eq('id', req.params.id).select().single();
  res.status(error ? 400 : 200).json({ success: !error, data, message: error?.message });
}
router.put('/admin/plans/:id', requireSupabaseAuth, requirePlatformAdmin, updatePlan);
router.patch('/admin/plans/:id', requireSupabaseAuth, requirePlatformAdmin, updatePlan);

// Superadmin account entitlement management. All writes are audited.
router.get('/admin/accounts', requireSupabaseAuth, requirePlatformAdmin, async (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  const { data: profiles, error } = await supabase.from('profiles').select('id,first_name,last_name,email,role,account_plan,custom_project_limit,commercial_status,created_at,entitlement_updated_at').order('created_at', { ascending: false });
  if (error) return res.status(400).json({ success: false, message: error.message });
  const rows = [];
  for (const profile of profiles || []) {
    if (query && !`${profile.first_name} ${profile.last_name} ${profile.email}`.toLowerCase().includes(query)) continue;
    const entitlement = await getEntitlement(profile.id, profile.role);
    rows.push({ ...profile, ...entitlement });
  }
  res.json({ success: true, data: rows });
});
router.get('/admin/accounts/:id', requireSupabaseAuth, requirePlatformAdmin, async (req, res) => {
  const { data: profile, error } = await supabase.from('profiles').select('id,first_name,last_name,email,role,account_plan,custom_project_limit,commercial_status,created_at,entitlement_updated_at').eq('id', req.params.id).maybeSingle();
  if (error || !profile) return res.status(404).json({ success: false, message: 'Cuenta no encontrada.' });
  const entitlement = await getEntitlement(profile.id, profile.role);
  res.json({ success: true, data: { ...profile, ...entitlement } });
});
router.get('/admin/accounts/:id/history', requireSupabaseAuth, requirePlatformAdmin, async (req, res) => {
  const { data, error } = await supabase.from('tshow_account_entitlement_history').select('*').eq('account_id', req.params.id).order('created_at', { ascending: false });
  res.status(error ? 400 : 200).json({ success: !error, data: data || [], message: error?.message });
});
router.patch('/admin/accounts/:id/entitlement', requireSupabaseAuth, requirePlatformAdmin, async (req, res) => {
  const plan = ['free', 'pro', 'max', 'enterprise'].includes(req.body.plan) ? req.body.plan : null;
  if (!plan) return res.status(400).json({ success: false, message: 'Nivel de cuenta inválido.' });
  const customLimit = req.body.customLimit === null || req.body.customLimit === '' || req.body.customLimit === undefined ? null : Number(req.body.customLimit);
  if (customLimit !== null && (!Number.isInteger(customLimit) || customLimit < 1)) return res.status(400).json({ success: false, message: 'El límite personalizado debe ser un entero mayor que cero.' });
  const status = ['free', 'active', 'expired', 'cancelled', 'read_only'].includes(req.body.status) ? req.body.status : (plan === 'free' ? 'free' : 'active');
  const { data: current } = await supabase.from('profiles').select('id,account_plan,custom_project_limit,commercial_status').eq('id', req.params.id).maybeSingle();
  if (!current) return res.status(404).json({ success: false, message: 'Cuenta no encontrada.' });
  const { data, error } = await supabase.from('profiles').update({ account_plan: plan, custom_project_limit: customLimit, commercial_status: status, entitlement_updated_at: new Date().toISOString(), entitlement_updated_by: req.user.id }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ success: false, message: error.message });
  await supabase.from('tshow_account_entitlement_history').insert({ account_id: req.params.id, changed_by: req.user.id, old_plan: current.account_plan, new_plan: plan, old_limit: current.custom_project_limit, new_limit: customLimit, old_status: current.commercial_status, new_status: status, reason: String(req.body.reason || '').slice(0, 500) });
  res.json({ success: true, data, message: 'Nivel y cupo actualizados.' });
});

module.exports = router;
