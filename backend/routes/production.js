const express = require('express');
const { supabase } = require('../supabaseClient');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');
const { normalizedBlockToLegacy } = require('../services/projectDocument');

const router = express.Router();

async function projectAccess(req, projectId, edit = false) {
  const { data: project } = await supabase.from('tshow_projects').select('*').eq('id', projectId).is('deleted_at', null).maybeSingle();
  if (!project) return null;
  if (req.user.profile?.role === 'platform_admin' || project.owner_id === req.user.id) return { project, role: project.owner_id === req.user.id ? 'owner' : 'admin' };
  if (project.organization_id) {
    const { data: organizationMember } = await supabase.from('tshow_organization_members')
      .select('role')
      .eq('organization_id', project.organization_id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (organizationMember && ['owner', 'admin'].includes(organizationMember.role)) {
      return { project, role: 'admin' };
    }
  }
  const { data: membership } = await supabase.from('tshow_project_members').select('role').eq('project_id', projectId).eq('user_id', req.user.id).maybeSingle();
  if (!membership || (edit && membership.role !== 'editor')) return null;
  return { project, role: membership.role };
}

router.get('/projects/:id/blocks', requireSupabaseAuth, async (req, res) => {
  const access = await projectAccess(req, req.params.id);
  if (!access) return res.status(403).json({ success: false, message: 'No tienes acceso a este evento.' });
  const { data, error } = await supabase.from('tshow_project_blocks').select('*').eq('project_id', req.params.id).order('position');
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({
    success: true,
    data: (data || []).map(block => ({ ...block, legacy: normalizedBlockToLegacy(block) })),
    version: access.project.document_version,
    permission: access.role
  });
});

router.get('/projects/:id/versions', requireSupabaseAuth, async (req, res) => {
  const access = await projectAccess(req, req.params.id);
  if (!access) return res.status(403).json({ success: false, message: 'No tienes acceso a este evento.' });
  const { data, error } = await supabase.from('tshow_project_document_versions')
    .select('id,version,reason,created_by,created_at')
    .eq('project_id', req.params.id)
    .order('version', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data: data || [], currentVersion: access.project.document_version });
});

router.post('/projects/:id/versions/:version/restore', requireSupabaseAuth, async (req, res) => {
  const access = await projectAccess(req, req.params.id, true);
  if (!access) return res.status(403).json({ success: false, message: 'No tienes permiso para restaurar versiones.' });
  const version = Number.parseInt(req.params.version, 10);
  if (!Number.isSafeInteger(version) || version < 1) return res.status(400).json({ success: false, message: 'Versión inválida.' });
  const { data: snapshot, error: snapshotError } = await supabase.from('tshow_project_document_versions')
    .select('snapshot')
    .eq('project_id', req.params.id)
    .eq('version', version)
    .maybeSingle();
  if (snapshotError || !snapshot) return res.status(404).json({ success: false, message: 'La versión solicitada no existe.' });
  const { data, error } = await supabase.from('tshow_projects')
    .update({ payload: snapshot.snapshot, event_name: snapshot.snapshot.eventName || access.project.event_name })
    .eq('id', req.params.id)
    .eq('document_version', access.project.document_version)
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ success: false, message: error.message });
  if (!data) return res.status(409).json({ success: false, message: 'El evento cambió mientras restaurabas la versión. Recarga e inténtalo nuevamente.' });
  await supabase.from('tshow_audit_log').insert({ project_id: req.params.id, actor_id: req.user.id, action: 'project.version_restored', metadata: { restoredVersion: version } });
  res.json({ success: true, data, message: `Versión ${version} restaurada.` });
});

module.exports = router;
