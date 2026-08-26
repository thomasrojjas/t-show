const crypto = require('crypto');
const express = require('express');
const { supabase } = require('../supabaseClient');
const { requireAuthenticatedUser, requireSupabaseAuth, requirePlatformAdmin } = require('../middleware/supabaseAuth');

const router = express.Router();
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
  if (isPlatformAdmin) return res.json({ success: true, data: owned || [] });
  const { data: memberships } = await supabase.from('tshow_project_members').select('project_id,role,tshow_projects(*)').eq('user_id', id);
  const projects = [...owned, ...(memberships || []).map(m => ({ ...m.tshow_projects, member_role: m.role })).filter(Boolean)];
  res.json({ success: true, data: projects });
});

router.post('/projects', requireSupabaseAuth, async (req, res) => {
  const payload = cleanPayload(req.body);
  if (!payload.eventName) return res.status(400).json({ success: false, message: 'El nombre del evento es requerido.' });
  const { data, error } = await supabase.from('tshow_projects').insert({ owner_id: req.user.id, event_name: payload.eventName, payload }).select().single();
  if (error) return res.status(error.code === 'P0001' || error.code === '23514' ? 409 : 400).json({ success: false, message: error.message });
  await audit(data.id, req.user.id, 'project.created');
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
  const { data, error } = await supabase.from('tshow_projects').update({ event_name: payload.eventName, payload }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ success: false, message: error.message });
  await audit(data.id, req.user.id, 'project.updated');
  res.json({ success: true, data });
});

router.delete('/projects/:id', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req, true);
  if (!granted || granted.role !== 'owner') return res.status(403).json({ success: false, message: 'Solo el propietario puede eliminarlo.' });
  await supabase.from('tshow_projects').update({ deleted_at: new Date().toISOString() }).eq('id', req.params.id);
  await audit(req.params.id, req.user.id, 'project.deleted');
  res.json({ success: true });
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
  if (!await accessForRequest(req.params.id, req)) return res.status(403).json({ success: false, message: 'Sin acceso.' });
  const { data, error } = await supabase.from('tshow_project_members').select('role,created_at,profiles(id,first_name,last_name,email)').eq('project_id', req.params.id);
  if (error) return res.status(400).json({ success: false, message: error.message });
  res.json({ success: true, data });
});
router.get('/projects/:id/invitations', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req);
  if (!granted || granted.role !== 'admin' && granted.role !== 'owner') return res.status(403).json({ success: false, message: 'Sin permiso.' });
  const { data, error } = await supabase.from('tshow_invitations').select('id,email,role,status,expires_at,created_at').eq('project_id', req.params.id).order('created_at', { ascending: false });
  res.status(error ? 400 : 200).json({ success: !error, data: data || [], message: error?.message });
});
router.post('/projects/:id/invitations', requireSupabaseAuth, async (req, res) => {
  const granted = await accessForRequest(req.params.id, req, true);
  if (!granted || granted.role !== 'owner') return res.status(403).json({ success: false, message: 'Solo el propietario puede invitar.' });
  const email = String(req.body.email || '').trim().toLowerCase(); const role = req.body.role === 'editor' ? 'editor' : 'viewer';
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ success: false, message: 'Correo inválido.' });
  const token = crypto.randomBytes(32).toString('base64url'); const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data, error } = await supabase.from('tshow_invitations').insert({ project_id: req.params.id, email, role, token_hash: tokenHash, invited_by: req.user.id }).select('id,email,role,expires_at').single();
  if (error) return res.status(400).json({ success: false, message: error.message });
  await audit(req.params.id, req.user.id, 'invitation.created', { email, role });
  // Email delivery is deliberately delegated to the configured transactional provider.
  if (process.env.RESEND_API_KEY) {
    const inviteUrl = `${process.env.FRONTEND_URL || process.env.CORS_ORIGIN}/register.html?invite=${encodeURIComponent(token)}`;
    await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.RESEND_FROM || 'T-Show <noreply@t-show.site>', to: [email], subject: 'Invitación a colaborar en T-Show', html: `<p>Has sido invitado a colaborar en un proyecto de T-Show.</p><p><a href="${inviteUrl}">Aceptar invitación</a></p><p>El enlace vence en 7 días.</p>` }) }).catch(error => console.error('Invitation email failed:', error.message));
  }
  res.status(201).json({ success: true, data });
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
router.delete('/invitations/:id', requireSupabaseAuth, async (req, res) => {
  const { data: invite } = await supabase.from('tshow_invitations').select('project_id').eq('id', req.params.id).maybeSingle();
  if (!invite) return res.status(404).json({ success: false, message: 'Invitación no encontrada.' });
  const granted = await accessForRequest(invite.project_id, req);
  if (!granted || granted.role !== 'admin' && granted.role !== 'owner') return res.status(403).json({ success: false, message: 'Sin permiso.' });
  const { error } = await supabase.from('tshow_invitations').update({ status: 'revoked' }).eq('id', req.params.id);
  if (!error) await audit(invite.project_id, req.user.id, 'invitation.revoked');
  res.status(error ? 400 : 200).json({ success: !error, message: error?.message });
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
  res.status(error ? 400 : 200).json({ success: !error, data: data || [], message: error?.message });
});
router.get('/billing/subscription', requireSupabaseAuth, async (req, res) => {
  const { data, error } = await supabase.from('tshow_subscriptions').select('*,tshow_plans(*)').eq('account_id', req.user.id).maybeSingle();
  res.status(error ? 400 : 200).json({ success: !error, data, message: error?.message });
});
router.put('/admin/plans/:id', requireSupabaseAuth, requirePlatformAdmin, async (req, res) => {
  const { name, amount_clp, active, benefits } = req.body;
  const { data, error } = await supabase.from('tshow_plans').update({ name, amount_clp, active, benefits }).eq('id', req.params.id).select().single();
  res.status(error ? 400 : 200).json({ success: !error, data, message: error?.message });
});

module.exports = router;
