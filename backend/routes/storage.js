const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { supabase } = require('../supabaseClient');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');
const { client, configured } = require('../r2');

const router = express.Router();
const rules = {
  avatar: { types: new Set(['image/jpeg', 'image/png', 'image/webp']), max: 5 * 1024 * 1024 },
  cover: { types: new Set(['image/jpeg', 'image/png', 'image/webp']), max: 10 * 1024 * 1024 },
  document: { types: new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']), max: 25 * 1024 * 1024 },
  incident_evidence: { types: new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']), max: 10 * 1024 * 1024 },
  block_attachment: { types: new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']), max: 25 * 1024 * 1024 }
};

const safeName = value => path.basename(String(value || 'archivo')).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180) || 'archivo';
const extensionFor = (filename, contentType) => {
  const supplied = path.extname(filename).replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();
  if (supplied) return supplied;
  return contentType === 'application/pdf' ? '.pdf' : contentType === 'image/jpeg' ? '.jpg' : contentType === 'image/png' ? '.png' : contentType === 'image/webp' ? '.webp' : '.bin';
};

async function projectAccess(projectId, req, write = false) {
  const { data: project } = await supabase.from('tshow_projects').select('id,owner_id,organization_id').eq('id', projectId).is('deleted_at', null).maybeSingle();
  if (!project) return null;
  if (req.user.profile?.role === 'platform_admin' || project.owner_id === req.user.id) return { project, role: 'owner' };
  const { data: member } = await supabase.from('tshow_project_members').select('role').eq('project_id', projectId).eq('user_id', req.user.id).maybeSingle();
  if (!member || (write && member.role !== 'editor')) return null;
  return { project, role: member.role };
}

router.post('/uploads/sign', requireSupabaseAuth, async (req, res, next) => {
  try {
    if (!configured()) return res.status(503).json({ success: false, code: 'R2_NOT_CONFIGURED', message: 'El almacenamiento no está configurado.' });
    const legacyScope = req.body.scope;
    const category = legacyScope === 'project' ? 'cover' : legacyScope === 'avatar' ? 'avatar' : String(req.body.category || '');
    const rule = rules[category];
    const projectId = req.body.projectId || null;
    const contentType = String(req.body.contentType || '');
    const size = Number(req.body.size);
    const filename = safeName(req.body.filename || `archivo${extensionFor('', contentType)}`);
    if (!rule || !rule.types.has(contentType) || !Number.isFinite(size) || size <= 0 || size > rule.max) return res.status(400).json({ success: false, code: 'UPLOAD_INVALID', message: 'El tipo o tamaño del archivo no está permitido.' });
    let access = null;
    if (category !== 'avatar') {
      access = await projectAccess(projectId, req, true);
      if (!access) return res.status(403).json({ success: false, code: 'PROJECT_FILE_FORBIDDEN', message: 'No tienes permisos para cargar archivos en este evento.' });
      if (category === 'cover' && !['owner'].includes(access.role) && req.user.profile?.role !== 'platform_admin') return res.status(403).json({ success: false, code: 'COVER_FORBIDDEN', message: 'Solo el propietario puede cambiar la portada.' });
    }
    const extension = extensionFor(filename, contentType);
    const objectKey = category === 'avatar'
      ? `users/${req.user.id}/avatars/${crypto.randomUUID()}${extension}`
      : category === 'cover'
        ? `projects/${projectId}/${crypto.randomUUID()}${extension}`
        : `organizations/${access.project.organization_id || 'personal'}/projects/${projectId}/${category}/${crypto.randomUUID()}${extension}`;
    const { data: intent, error } = await supabase.from('tshow_upload_intents').insert({ project_id: projectId, user_id: req.user.id, category, object_key: objectKey, original_filename: filename, content_type: contentType, expected_size: size }).select().single();
    if (error) throw new Error(error.message);
    const uploadUrl = await getSignedUrl(client(), new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: objectKey, ContentType: contentType, ContentLength: size, Metadata: { 'upload-intent': intent.id } }), { expiresIn: 300 });
    return res.json({ success: true, uploadId: intent.id, key: objectKey, uploadUrl, expiresIn: 300 });
  } catch (error) { return next(error); }
});

router.post('/uploads/:uploadId/finalize', requireSupabaseAuth, async (req, res, next) => {
  try {
    if (!configured()) return res.status(503).json({ success: false, code: 'R2_NOT_CONFIGURED', message: 'El almacenamiento no está configurado.' });
    const { data: intent } = await supabase.from('tshow_upload_intents').select('*').eq('id', req.params.uploadId).eq('user_id', req.user.id).maybeSingle();
    if (!intent || intent.status !== 'pending' || new Date(intent.expires_at) < new Date()) return res.status(409).json({ success: false, code: 'UPLOAD_INTENT_INVALID', message: 'La autorización de carga venció o ya fue utilizada.' });
    const object = await client().send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: intent.object_key }));
    if (Number(object.ContentLength) !== Number(intent.expected_size) || String(object.ContentType || '') !== intent.content_type) {
      await supabase.from('tshow_upload_intents').update({ status: 'failed' }).eq('id', intent.id);
      await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: intent.object_key })).catch(() => {});
      return res.status(422).json({ success: false, code: 'UPLOAD_METADATA_MISMATCH', message: 'El archivo recibido no coincide con la carga autorizada.' });
    }
    let asset = null;
    if (intent.category === 'avatar') {
      const { error } = await supabase.from('profiles').update({ avatar_key: intent.object_key }).eq('id', req.user.id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase.from('tshow_project_assets').insert({ project_id: intent.project_id, object_key: intent.object_key, filename: intent.original_filename, content_type: intent.content_type, size_bytes: intent.expected_size, category: intent.category, upload_intent_id: intent.id, uploaded_by: req.user.id }).select().single();
      if (error) throw new Error(error.message);
      asset = data;
    }
    await supabase.from('tshow_upload_intents').update({ status: 'finalized', finalized_at: new Date().toISOString() }).eq('id', intent.id);
    return res.status(201).json({ success: true, data: asset || { object_key: intent.object_key, category: 'avatar' } });
  } catch (error) { return next(error); }
});

router.get('/projects/:id/files', requireSupabaseAuth, async (req, res, next) => {
  try {
    if (!await projectAccess(req.params.id, req)) return res.status(403).json({ success: false, code: 'PROJECT_FILE_FORBIDDEN', message: 'No tienes acceso a estos archivos.' });
    let query = supabase.from('tshow_project_assets').select('id,project_id,block_id,filename,content_type,size_bytes,category,visibility,uploaded_by,created_at').eq('project_id', req.params.id).is('deleted_at', null).order('created_at', { ascending: false });
    if (req.query.category && rules[req.query.category]) query = query.eq('category', req.query.category);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
});

router.post('/files/:fileId/download', requireSupabaseAuth, async (req, res, next) => {
  try {
    if (!configured()) return res.status(503).json({ success: false, code: 'R2_NOT_CONFIGURED', message: 'El almacenamiento no está configurado.' });
    const { data: asset } = await supabase.from('tshow_project_assets').select('*').eq('id', req.params.fileId).is('deleted_at', null).maybeSingle();
    if (!asset || !await projectAccess(asset.project_id, req)) return res.status(404).json({ success: false, code: 'FILE_NOT_FOUND', message: 'Archivo no encontrado.' });
    const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(asset.filename)}`;
    const url = await getSignedUrl(client(), new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: asset.object_key, ResponseContentType: asset.content_type, ResponseContentDisposition: disposition }), { expiresIn: 300 });
    return res.json({ success: true, url, expiresIn: 300 });
  } catch (error) { return next(error); }
});

router.delete('/files/:fileId', requireSupabaseAuth, async (req, res, next) => {
  try {
    const { data: asset } = await supabase.from('tshow_project_assets').select('*').eq('id', req.params.fileId).is('deleted_at', null).maybeSingle();
    if (!asset || !await projectAccess(asset.project_id, req, true)) return res.status(404).json({ success: false, code: 'FILE_NOT_FOUND', message: 'Archivo no encontrado.' });
    await supabase.from('tshow_project_assets').update({ deleted_at: new Date().toISOString(), deletion_pending: true }).eq('id', asset.id);
    try {
      await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: asset.object_key }));
      await supabase.from('tshow_project_assets').update({ deletion_pending: false }).eq('id', asset.id);
    } catch (storageError) {
      console.error(JSON.stringify({ level: 'error', operation: 'r2_delete', fileId: asset.id, requestId: req.requestId, message: storageError.message }));
    }
    return res.json({ success: true });
  } catch (error) { return next(error); }
});

router.post('/files/:fileId/replace', requireSupabaseAuth, async (req, res, next) => {
  try {
    const { uploadId } = req.body || {};
    const { data: previous } = await supabase.from('tshow_project_assets').select('*').eq('id', req.params.fileId).is('deleted_at', null).maybeSingle();
    const { data: replacement } = await supabase.from('tshow_project_assets').select('*').eq('upload_intent_id', uploadId).is('deleted_at', null).maybeSingle();
    if (!previous || !replacement || previous.project_id !== replacement.project_id || previous.category !== replacement.category) {
      return res.status(400).json({ success: false, code: 'FILE_REPLACEMENT_INVALID', message: 'El archivo de reemplazo no corresponde al original.' });
    }
    if (!await projectAccess(previous.project_id, req, true)) return res.status(403).json({ success: false, code: 'FILE_REPLACE_FORBIDDEN', message: 'No tienes permisos para reemplazar este archivo.' });
    await supabase.from('tshow_project_assets').update({ replaced_by: replacement.id, deleted_at: new Date().toISOString(), deletion_pending: true }).eq('id', previous.id);
    try {
      await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: previous.object_key }));
      await supabase.from('tshow_project_assets').update({ deletion_pending: false }).eq('id', previous.id);
    } catch (storageError) {
      console.error(JSON.stringify({ level: 'error', operation: 'r2_replace_cleanup', fileId: previous.id, requestId: req.requestId, message: storageError.message }));
    }
    return res.json({ success: true, data: replacement });
  } catch (error) { return next(error); }
});

router.post('/uploads/cleanup', express.json({ limit: '10kb' }), async (req, res, next) => {
  try {
    if (!process.env.CRON_SECRET || req.get('x-cron-secret') !== process.env.CRON_SECRET) return res.status(401).json({ success: false, code: 'CRON_UNAUTHORIZED', message: 'Acceso denegado.' });
    if (!configured()) return res.status(503).json({ success: false, code: 'R2_NOT_CONFIGURED', message: 'El almacenamiento no está configurado.' });
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: stale } = await supabase.from('tshow_upload_intents').select('id,object_key').eq('status', 'pending').lt('created_at', cutoff).limit(100);
    let expired = 0;
    for (const intent of stale || []) {
      await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: intent.object_key })).catch(() => {});
      await supabase.from('tshow_upload_intents').update({ status: 'expired' }).eq('id', intent.id);
      expired += 1;
    }
    const { data: pendingDeletes } = await supabase.from('tshow_project_assets').select('id,object_key').eq('deletion_pending', true).limit(100);
    let cleaned = 0;
    for (const asset of pendingDeletes || []) {
      try {
        await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: asset.object_key }));
        await supabase.from('tshow_project_assets').update({ deletion_pending: false }).eq('id', asset.id);
        cleaned += 1;
      } catch (error) {
        await supabase.from('tshow_cleanup_jobs').insert({ job_type: 'orphan_object', resource_id: asset.id, status: 'failed', attempts: 1, last_error: String(error.message).slice(0, 500), run_after: new Date(Date.now() + 86400000).toISOString() });
      }
    }
    return res.json({ success: true, expiredUploads: expired, cleanedObjects: cleaned });
  } catch (error) { return next(error); }
});

// Compatibility endpoint for already persisted cover/avatar keys.
router.post('/uploads/:key(*)/url', requireSupabaseAuth, async (req, res, next) => {
  try {
    if (!configured()) return res.status(503).json({ success: false, code: 'R2_NOT_CONFIGURED', message: 'El almacenamiento no está configurado.' });
    const key = req.params.key;
    let allowed = key.startsWith(`users/${req.user.id}/avatars/`) || key.startsWith(`avatars/${req.user.id}/`);
    if (!allowed) {
      const { data: project } = await supabase.from('tshow_projects').select('id').eq('cover_key', key).is('deleted_at', null).maybeSingle();
      const { data: asset } = project ? { data: null } : await supabase.from('tshow_project_assets').select('project_id').eq('object_key', key).is('deleted_at', null).maybeSingle();
      const projectId = project?.id || asset?.project_id;
      allowed = Boolean(projectId && await projectAccess(projectId, req));
    }
    if (!allowed) return res.status(403).json({ success: false, code: 'FILE_FORBIDDEN', message: 'Sin acceso al archivo.' });
    const url = await getSignedUrl(client(), new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }), { expiresIn: 300 });
    return res.json({ success: true, url, expiresIn: 300 });
  } catch (error) { return next(error); }
});

module.exports = router;
