const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const router = express.Router();
const contactLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Demasiadas solicitudes. Intenta nuevamente más tarde.' } });
router.post('/contact', contactLimiter, async (req, res) => {
  const { name, email, organization, message, website, intent, city, eventDate, audience, boothCount, role, phone, plan, interval } = req.body || {};
  if (website) return res.json({ success: true });
  const cleanName = String(name || '').trim(); const cleanEmail = String(email || '').trim().toLowerCase(); const cleanMessage = String(message || '').trim();
  if (cleanName.length < 2 || cleanName.length > 120 || !/^\S+@\S+\.\S+$/.test(cleanEmail) || cleanMessage.length < 10 || cleanMessage.length > 4000) return res.status(400).json({ success: false, message: 'Completa nombre, correo y mensaje con datos válidos.' });
  const cleanIntent = ['rental', 'demo', 'suite'].includes(String(intent || '').trim()) ? String(intent).trim() : 'general';
  const cleanCity = String(city || '').trim(); const cleanOrganization = String(organization || '').trim(); const cleanRole = String(role || '').trim(); const cleanPhone = String(phone || '').trim();
  const cleanEventDate = String(eventDate || '').trim(); const cleanAudience = String(audience || '').trim(); const cleanBoothCount = String(boothCount || '').trim();
  const cleanPlan = String(plan || '').trim(); const cleanInterval = interval === 'annual' ? 'anual' : interval === 'monthly' ? 'mensual' : '';
  if (intent || city || eventDate || audience || boothCount || role || phone) {
    if (cleanCity.length > 120 || cleanOrganization.length > 180 || cleanRole.length > 120 || cleanPhone.length > 40 || cleanEventDate.length > 40 || cleanAudience.length > 12 || cleanBoothCount.length > 4 || cleanPlan.length > 120) return res.status(400).json({ success: false, message: 'Revisa los datos de la propuesta e inténtalo nuevamente.' });
    if (cleanAudience && (!/^\d+$/.test(cleanAudience) || Number(cleanAudience) < 1 || Number(cleanAudience) > 1000000)) return res.status(400).json({ success: false, message: 'El aforo debe ser un número válido.' });
    if (cleanBoothCount && (!/^\d+$/.test(cleanBoothCount) || Number(cleanBoothCount) < 1 || Number(cleanBoothCount) > 100)) return res.status(400).json({ success: false, message: 'La cantidad de puestos debe ser un número válido.' });
  }
  if (!process.env.RESEND_API_KEY) return res.status(503).json({ success: false, message: 'El canal de contacto no está configurado.' });
  const requestId = crypto.randomUUID();
  const details = intent || city || eventDate || audience || boothCount || role || phone || plan ? `<h3>Solicitud comercial</h3><p><strong>Plan:</strong> ${escapeHtml(cleanPlan || 'Por definir')}${cleanInterval ? ` · ${cleanInterval}` : ''}</p><p><strong>Intención:</strong> ${escapeHtml(cleanIntent)}</p><p><strong>Ciudad:</strong> ${escapeHtml(cleanCity || 'Por definir')}</p><p><strong>Fecha:</strong> ${escapeHtml(cleanEventDate || 'Por definir')}</p><p><strong>Aforo:</strong> ${escapeHtml(cleanAudience || 'No indicado')}</p><p><strong>Puestos:</strong> ${escapeHtml(cleanBoothCount || 'No indicado')}</p><p><strong>Rol:</strong> ${escapeHtml(cleanRole || 'No indicado')}</p><p><strong>Teléfono:</strong> ${escapeHtml(cleanPhone || 'No indicado')}</p>` : '';
  const html = `<h2>Nuevo contacto T-Show</h2><p><strong>Referencia:</strong> ${requestId}</p><p><strong>Nombre:</strong> ${escapeHtml(cleanName)}</p><p><strong>Correo:</strong> ${escapeHtml(cleanEmail)}</p><p><strong>Organización:</strong> ${escapeHtml(cleanOrganization || 'No indicada')}</p>${details}<p>${escapeHtml(cleanMessage).replace(/\n/g, '<br>')}</p>`;
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.RESEND_FROM || 'T-Show <noreply@t-show.site>', to: ['contacto@baseandes.com'], reply_to: cleanEmail, subject: `Contacto T-Show — ${cleanName}`, html }) });
  if (!response.ok) return res.status(502).json({ success: false, message: 'No se pudo enviar el mensaje.' });
  res.json({ success: true, requestId, message: 'Recibimos tu solicitud. Revisaremos disponibilidad y configuración para tu evento.' });
});
function escapeHtml(value) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
module.exports = router;
