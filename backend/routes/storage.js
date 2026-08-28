const crypto = require('crypto');
const express = require('express');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { supabase } = require('../supabaseClient');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');
const { client, configured } = require('../r2');
const router = express.Router();
const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
async function canReadProject(projectId, req) {
  if (req.user.profile?.role === 'platform_admin') return true;
  const { data: project } = await supabase.from('tshow_projects').select('owner_id').eq('id', projectId).is('deleted_at', null).maybeSingle();
  if (!project) return false;
  if (project.owner_id === req.user.id) return true;
  const { data: member } = await supabase.from('tshow_project_members').select('project_id').eq('project_id', projectId).eq('user_id', req.user.id).maybeSingle();
  return Boolean(member);
}
router.post('/uploads/sign', requireSupabaseAuth, async (req, res) => {
  const { scope, projectId, contentType, size } = req.body;
  if (!configured()) return res.status(503).json({ success: false, message: 'Almacenamiento no configurado.' });
  if (!allowed.has(contentType) || !Number.isFinite(size) || size <= 0 || size > 10 * 1024 * 1024) return res.status(400).json({ success: false, message: 'Imagen inválida: JPEG, PNG o WebP de hasta 10 MB.' });
  if (scope !== 'avatar' && scope !== 'project') return res.status(400).json({ success: false, message: 'Ámbito inválido.' });
  if (scope === 'project') { const { data } = await supabase.from('tshow_projects').select('owner_id').eq('id', projectId).is('deleted_at', null).maybeSingle(); if (!data || data.owner_id !== req.user.id && req.user.profile?.role !== 'platform_admin') return res.status(403).json({ success: false, message: 'Solo el propietario puede cambiar la imagen del proyecto.' }); }
  const ext = contentType.split('/')[1] === 'jpeg' ? 'jpg' : contentType.split('/')[1];
  const key = `${scope === 'avatar' ? `avatars/${req.user.id}` : `projects/${projectId}`}/${crypto.randomUUID()}.${ext}`;
  const url = await getSignedUrl(client(), new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: contentType }), { expiresIn: 300 });
  res.json({ success: true, key, uploadUrl: url, expiresIn: 300 });
});
router.post('/uploads/:key(*)/url', requireSupabaseAuth, async (req, res) => {
  if (!configured()) return res.status(503).json({ success: false });
  const key = req.params.key;
  if (key.startsWith(`avatars/${req.user.id}/`)) {
    const url = await getSignedUrl(client(), new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }), { expiresIn: 300 });
    return res.json({ success: true, url, expiresIn: 300 });
  }
  const match = key.match(/^projects\/([0-9a-f-]{36})\//i);
  if (!match || !await canReadProject(match[1], req)) return res.status(403).json({ success: false, message: 'Sin acceso al archivo.' });
  const url = await getSignedUrl(client(), new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }), { expiresIn: 300 });
  res.json({ success: true, url, expiresIn: 300 });
});
module.exports = router;
