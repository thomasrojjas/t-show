const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const contactLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Demasiadas solicitudes. Intenta nuevamente más tarde.' } });
router.post('/contact', contactLimiter, async (req, res) => {
  const { name, email, organization, message, website } = req.body || {};
  if (website) return res.json({ success: true });
  const cleanName = String(name || '').trim(); const cleanEmail = String(email || '').trim().toLowerCase(); const cleanMessage = String(message || '').trim();
  if (cleanName.length < 2 || cleanName.length > 120 || !/^\S+@\S+\.\S+$/.test(cleanEmail) || cleanMessage.length < 10 || cleanMessage.length > 4000) return res.status(400).json({ success: false, message: 'Completa nombre, correo y mensaje con datos válidos.' });
  if (!process.env.RESEND_API_KEY) return res.status(503).json({ success: false, message: 'El canal de contacto no está configurado.' });
  const html = `<h2>Nuevo contacto T-Show</h2><p><strong>Nombre:</strong> ${escapeHtml(cleanName)}</p><p><strong>Correo:</strong> ${escapeHtml(cleanEmail)}</p><p><strong>Organización:</strong> ${escapeHtml(String(organization || '').trim() || 'No indicada')}</p><p>${escapeHtml(cleanMessage).replace(/\n/g, '<br>')}</p>`;
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.RESEND_FROM || 'T-Show <noreply@t-show.site>', to: ['contacto@baseandes.com'], reply_to: cleanEmail, subject: `Contacto T-Show — ${cleanName}`, html }) });
  if (!response.ok) return res.status(502).json({ success: false, message: 'No se pudo enviar el mensaje.' });
  res.json({ success: true, message: 'Mensaje enviado correctamente.' });
});
function escapeHtml(value) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
module.exports = router;
