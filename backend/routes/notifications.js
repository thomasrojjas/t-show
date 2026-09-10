const express = require('express');
const { supabase } = require('../supabaseClient');

const router = express.Router();

function clean(value, max = 180) {
  return String(value || '').replace(/[<>&"]+/g, '').trim().slice(0, max);
}

function eventTimeLabel(iso) {
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

async function sendReminderEmail({ email, eventName, eventStartAt, projectId }) {
  const baseUrl = process.env.FRONTEND_URL || String(process.env.CORS_ORIGIN || '').split(',')[0];
  const url = `${baseUrl}/summary?project=${encodeURIComponent(projectId)}`;
  const safeName = clean(eventName || 'tu evento');
  const when = eventTimeLabel(eventStartAt);
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#050609;color:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050609"><tr><td align="center" style="padding:48px 20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;border:1px solid #293044;background:#090d18"><tr><td style="padding:36px"><p style="margin:0 0 48px;font-size:13px;font-weight:800;letter-spacing:.24em;color:#f5f5f2">T-SHOW</p><p style="margin:0 0 12px;color:#9fc4ff;font-size:11px;font-weight:700;letter-spacing:.18em">RECORDATORIO DE OPERACIÓN</p><h1 style="margin:0 0 20px;font-size:38px;line-height:1.05;color:#f5f5f2">Tu evento comienza en 15 minutos.</h1><p style="margin:0 0 8px;color:#f5f5f2;font-size:20px;font-weight:700">${safeName}</p><p style="margin:0 0 30px;color:#b9beca;font-size:15px;line-height:1.6">Inicio programado: ${when} (hora de Chile).</p><a href="${url}" style="display:inline-block;padding:15px 22px;background:#b9d5ff;color:#07101f;text-decoration:none;font-weight:700">Abrir evento</a><p style="margin:30px 0 0;color:#777f8e;font-size:12px;line-height:1.5">Este aviso se envía automáticamente desde T-Show · BaseAndes.</p></td></tr></table></td></tr></table></body></html>`;
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.RESEND_FROM || 'T-Show <noreply@t-show.site>', to: [email], subject: `Tu evento comienza en 15 minutos · ${safeName}`, html }) });
  if (!response.ok) throw new Error((await response.text()).slice(0, 500));
}

async function processReminders(req, res) {
  if (!process.env.CRON_SECRET || req.get('x-cron-secret') !== process.env.CRON_SECRET) return res.status(401).json({ success: false, code: 'CRON_UNAUTHORIZED', message: 'Acceso denegado.' });
  if (!process.env.RESEND_API_KEY) return res.status(503).json({ success: false, code: 'REMINDERS_NOT_CONFIGURED', message: 'Los recordatorios requieren RESEND_API_KEY.' });
  const { data: reminders, error } = await supabase.rpc('claim_event_start_reminders', { p_now: new Date().toISOString(), p_minutes: 15 });
  if (error) return res.status(500).json({ success: false, code: 'REMINDER_CLAIM_FAILED', message: 'No se pudieron preparar los recordatorios.' });
  const results = [];
  for (const reminder of reminders || []) {
    const { data: project } = await supabase.from('tshow_projects').select('owner_id').eq('id', reminder.project_id).maybeSingle();
    if (!project) continue;
    const { data: memberships } = await supabase.from('tshow_project_members').select('user_id').eq('project_id', reminder.project_id);
    const ids = [...new Set([project.owner_id, ...(memberships || []).map(row => row.user_id)].filter(Boolean))];
    const { data: profiles } = await supabase.from('profiles').select('id,email').in('id', ids);
    let sent = 0; let lastError = null;
    for (const profile of profiles || []) {
      if (!profile.email) continue;
      try { await sendReminderEmail({ email: profile.email, eventName: reminder.event_name, eventStartAt: reminder.event_start_at, projectId: reminder.project_id }); sent += 1; }
      catch (sendError) { lastError = String(sendError.message).slice(0, 500); }
    }
    const status = sent > 0 && !lastError ? 'sent' : 'failed';
    await supabase.from('tshow_event_reminders').update({ delivery_status: status, sent_at: status === 'sent' ? new Date().toISOString() : null, recipient_count: sent, last_error: lastError }).eq('project_id', reminder.project_id).eq('event_start_at', reminder.event_start_at).eq('reminder_minutes', 15);
    results.push({ projectId: reminder.project_id, status, recipientCount: sent });
  }
  return res.json({ success: true, data: { processed: results.length, reminders: results } });
}

router.get('/notifications/event-reminders', processReminders);
router.post('/notifications/event-reminders', processReminders);

module.exports = router;
