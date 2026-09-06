const express = require('express');
const { supabase } = require('../supabaseClient');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');

const router = express.Router();
const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const validUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

async function organizationAccess(req, organizationId, manage = false) {
  if (!validUuid(organizationId)) return null;
  if (req.user.profile?.role === 'platform_admin') return { role: 'admin' };
  const { data } = await supabase.from('tshow_organization_members')
    .select('role').eq('organization_id', organizationId).eq('user_id', req.user.id).maybeSingle();
  if (!data || (manage && !['owner', 'admin'].includes(data.role))) return null;
  return data;
}

async function projectAccess(req, projectId, edit = false) {
  if (!validUuid(projectId)) return null;
  const { data: project } = await supabase.from('tshow_projects')
    .select('id,owner_id,organization_id').eq('id', projectId).is('deleted_at', null).maybeSingle();
  if (!project) return null;
  if (req.user.profile?.role === 'platform_admin' || project.owner_id === req.user.id) return { project, role: 'admin' };
  if (project.organization_id) {
    const org = await organizationAccess(req, project.organization_id, edit);
    if (org && (!edit || ['owner', 'admin'].includes(org.role))) return { project, role: org.role };
  }
  const { data: member } = await supabase.from('tshow_project_members')
    .select('role').eq('project_id', projectId).eq('user_id', req.user.id).maybeSingle();
  if (!member || (edit && member.role !== 'editor')) return null;
  return { project, role: member.role };
}

function audit(projectId, actorId, action, metadata = {}) {
  return supabase.from('tshow_audit_log').insert({ project_id: projectId || null, actor_id: actorId, action, metadata });
}
async function directoryRecordBelongs(table, recordId, organizationId) {
  if (!recordId) return true;
  const { data } = await supabase.from(table).select('id').eq('id', recordId).eq('organization_id', organizationId).is('archived_at', null).maybeSingle();
  return Boolean(data);
}

const directories = {
  clients: {
    table: 'tshow_clients', name: 'legal_name', fields: ['legal_name','trade_name','tax_id','email','phone','address','notes']
  },
  venues: {
    table: 'tshow_venues', name: 'name', fields: ['name','address','city','capacity','contact_name','contact_email','contact_phone','technical_notes']
  },
  suppliers: {
    table: 'tshow_suppliers', name: 'name', fields: ['name','category','tax_id','email','phone','contact_name','notes']
  }
};

function directoryPayload(config, body) {
  const payload = {};
  for (const field of config.fields) {
    if (body[field] === undefined) continue;
    payload[field] = field === 'capacity' ? (body[field] === null || body[field] === '' ? null : Number(body[field])) : clean(body[field], field.includes('notes') ? 8000 : 500);
  }
  return payload;
}

router.get('/organizations/:organizationId/:resource(clients|venues|suppliers)', requireSupabaseAuth, async (req, res) => {
  if (!await organizationAccess(req, req.params.organizationId)) return fail(res, 403, 'No tienes acceso a esta organización.');
  const config = directories[req.params.resource];
  const { data, error } = await supabase.from(config.table).select('*')
    .eq('organization_id', req.params.organizationId).is('archived_at', null).order(config.name);
  return error ? fail(res, 500, error.message) : res.json({ success: true, data: data || [] });
});

router.post('/organizations/:organizationId/:resource(clients|venues|suppliers)', requireSupabaseAuth, async (req, res) => {
  if (!await organizationAccess(req, req.params.organizationId, true)) return fail(res, 403, 'No tienes permiso para administrar este directorio.');
  const config = directories[req.params.resource];
  const payload = directoryPayload(config, req.body || {});
  if (clean(payload[config.name], 180).length < 2) return fail(res, 400, 'El nombre debe tener al menos 2 caracteres.');
  const { data, error } = await supabase.from(config.table)
    .insert({ ...payload, organization_id: req.params.organizationId, created_by: req.user.id }).select().single();
  return error ? fail(res, 400, error.message) : res.status(201).json({ success: true, data });
});

router.patch('/organizations/:organizationId/:resource(clients|venues|suppliers)/:recordId', requireSupabaseAuth, async (req, res) => {
  if (!await organizationAccess(req, req.params.organizationId, true)) return fail(res, 403, 'No tienes permiso para administrar este directorio.');
  const config = directories[req.params.resource];
  const payload = directoryPayload(config, req.body || {});
  if (!Object.keys(payload).length) return fail(res, 400, 'No hay cambios válidos.');
  const { data, error } = await supabase.from(config.table).update(payload)
    .eq('id', req.params.recordId).eq('organization_id', req.params.organizationId).select().maybeSingle();
  if (error) return fail(res, 400, error.message);
  return data ? res.json({ success: true, data }) : fail(res, 404, 'Registro no encontrado.');
});

router.delete('/organizations/:organizationId/:resource(clients|venues|suppliers)/:recordId', requireSupabaseAuth, async (req, res) => {
  if (!await organizationAccess(req, req.params.organizationId, true)) return fail(res, 403, 'No tienes permiso para administrar este directorio.');
  const config = directories[req.params.resource];
  const { data, error } = await supabase.from(config.table).update({ archived_at: new Date().toISOString() })
    .eq('id', req.params.recordId).eq('organization_id', req.params.organizationId).select('id').maybeSingle();
  if (error) return fail(res, 400, error.message);
  return data ? res.json({ success: true }) : fail(res, 404, 'Registro no encontrado.');
});

router.get('/projects/:id/finance', requireSupabaseAuth, async (req, res) => {
  if (!await projectAccess(req, req.params.id)) return fail(res, 403, 'No tienes acceso a las finanzas de este evento.');
  const [{ data: finance, error }, { data: expenses }] = await Promise.all([
    supabase.from('tshow_event_finances').select('*').eq('project_id', req.params.id).maybeSingle(),
    supabase.from('tshow_expenses').select('*,tshow_suppliers(name)').eq('project_id', req.params.id).order('created_at', { ascending: false })
  ]);
  if (error) return fail(res, 500, error.message);
  const rows = expenses || [];
  const paid = rows.filter(item => item.status === 'paid').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const committed = rows.filter(item => ['approved','paid'].includes(item.status)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  res.json({ success: true, data: { finance: finance || { project_id: req.params.id, currency: 'CLP', budget_amount: 0, contingency_amount: 0 }, expenses: rows, totals: { paid, committed } } });
});

router.put('/projects/:id/finance', requireSupabaseAuth, async (req, res) => {
  if (!await projectAccess(req, req.params.id, true)) return fail(res, 403, 'No tienes permiso para editar las finanzas.');
  const budget = Number(req.body.budgetAmount || 0);
  const contingency = Number(req.body.contingencyAmount || 0);
  if (!Number.isSafeInteger(budget) || budget < 0 || !Number.isSafeInteger(contingency) || contingency < 0) return fail(res, 400, 'Los montos deben ser enteros positivos.');
  const { data, error } = await supabase.from('tshow_event_finances').upsert({
    project_id: req.params.id, currency: clean(req.body.currency || 'CLP', 3).toUpperCase(),
    budget_amount: budget, contingency_amount: contingency, updated_by: req.user.id
  }).select().single();
  if (error) return fail(res, 400, error.message);
  await audit(req.params.id, req.user.id, 'finance.updated');
  res.json({ success: true, data });
});

router.post('/projects/:id/expenses', requireSupabaseAuth, async (req, res) => {
  const access = await projectAccess(req, req.params.id, true);
  if (!access) return fail(res, 403, 'No tienes permiso para registrar gastos.');
  const amount = Number(req.body.amount);
  const description = clean(req.body.description, 240);
  if (description.length < 2 || !Number.isSafeInteger(amount) || amount < 0) return fail(res, 400, 'Descripción y monto válido son obligatorios.');
  const supplierId = validUuid(req.body.supplierId) ? req.body.supplierId : null;
  if (supplierId && !await directoryRecordBelongs('tshow_suppliers', supplierId, access.project.organization_id)) return fail(res, 400, 'El proveedor no pertenece a la organización del evento.');
  const { data, error } = await supabase.from('tshow_expenses').insert({
    project_id: req.params.id, supplier_id: supplierId,
    category: clean(req.body.category || 'other', 60), description, amount,
    due_at: req.body.dueAt || null, created_by: req.user.id
  }).select().single();
  if (error) return fail(res, 400, error.message);
  await audit(req.params.id, req.user.id, 'expense.created', { expenseId: data.id });
  res.status(201).json({ success: true, data });
});

router.patch('/projects/:id/expenses/:expenseId', requireSupabaseAuth, async (req, res) => {
  if (!await projectAccess(req, req.params.id, true)) return fail(res, 403, 'No tienes permiso para editar gastos.');
  const patch = {};
  if (req.body.status !== undefined && ['planned','approved','paid','cancelled'].includes(req.body.status)) patch.status = req.body.status;
  if (req.body.description !== undefined) patch.description = clean(req.body.description, 240);
  if (req.body.amount !== undefined) patch.amount = Number(req.body.amount);
  if (patch.status === 'paid') patch.paid_at = new Date().toISOString();
  const { data, error } = await supabase.from('tshow_expenses').update(patch)
    .eq('id', req.params.expenseId).eq('project_id', req.params.id).select().maybeSingle();
  if (error) return fail(res, 400, error.message);
  return data ? res.json({ success: true, data }) : fail(res, 404, 'Gasto no encontrado.');
});

router.get('/projects/:id/tasks', requireSupabaseAuth, async (req, res) => {
  if (!await projectAccess(req, req.params.id)) return fail(res, 403, 'No tienes acceso a las tareas.');
  const { data, error } = await supabase.from('tshow_tasks').select('*').eq('project_id', req.params.id).order('due_at');
  return error ? fail(res, 500, error.message) : res.json({ success: true, data: data || [] });
});

router.post('/projects/:id/tasks', requireSupabaseAuth, async (req, res) => {
  if (!await projectAccess(req, req.params.id, true)) return fail(res, 403, 'No tienes permiso para crear tareas.');
  const title = clean(req.body.title, 180);
  if (title.length < 2) return fail(res, 400, 'El título es obligatorio.');
  const { data, error } = await supabase.from('tshow_tasks').insert({
    project_id: req.params.id, title, description: clean(req.body.description),
    priority: ['low','medium','high','critical'].includes(req.body.priority) ? req.body.priority : 'medium',
    assigned_to: validUuid(req.body.assignedTo) ? req.body.assignedTo : null,
    due_at: req.body.dueAt || null, created_by: req.user.id
  }).select().single();
  if (error) return fail(res, 400, error.message);
  await audit(req.params.id, req.user.id, 'task.created', { taskId: data.id });
  res.status(201).json({ success: true, data });
});

router.patch('/projects/:id/tasks/:taskId', requireSupabaseAuth, async (req, res) => {
  if (!await projectAccess(req, req.params.id, true)) return fail(res, 403, 'No tienes permiso para actualizar tareas.');
  const patch = {};
  if (req.body.title !== undefined) patch.title = clean(req.body.title, 180);
  if (req.body.description !== undefined) patch.description = clean(req.body.description);
  if (['pending','in_progress','blocked','completed','cancelled'].includes(req.body.status)) patch.status = req.body.status;
  if (['low','medium','high','critical'].includes(req.body.priority)) patch.priority = req.body.priority;
  if (req.body.assignedTo !== undefined) patch.assigned_to = validUuid(req.body.assignedTo) ? req.body.assignedTo : null;
  if (req.body.dueAt !== undefined) patch.due_at = req.body.dueAt || null;
  if (patch.status === 'completed') patch.completed_at = new Date().toISOString();
  const { data, error } = await supabase.from('tshow_tasks').update(patch)
    .eq('id', req.params.taskId).eq('project_id', req.params.id).select().maybeSingle();
  if (error) return fail(res, 400, error.message);
  return data ? res.json({ success: true, data }) : fail(res, 404, 'Tarea no encontrada.');
});

router.get('/projects/:id/quotes', requireSupabaseAuth, async (req, res) => {
  if (!await projectAccess(req, req.params.id)) return fail(res, 403, 'No tienes acceso a las cotizaciones.');
  const { data, error } = await supabase.from('tshow_quotes')
    .select('*,tshow_quote_items(*)').eq('project_id', req.params.id).order('created_at', { ascending: false });
  return error ? fail(res, 500, error.message) : res.json({ success: true, data: data || [] });
});

router.post('/projects/:id/quotes', requireSupabaseAuth, async (req, res) => {
  const access = await projectAccess(req, req.params.id, true);
  if (!access) return fail(res, 403, 'No tienes permiso para crear cotizaciones.');
  const number = clean(req.body.number, 60);
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 200) : [];
  if (!number || !items.length) return fail(res, 400, 'Número y al menos un ítem son obligatorios.');
  const clientId = validUuid(req.body.clientId) ? req.body.clientId : null;
  if (clientId && !await directoryRecordBelongs('tshow_clients', clientId, access.project.organization_id)) return fail(res, 400, 'El cliente no pertenece a la organización del evento.');
  const { data: quote, error } = await supabase.from('tshow_quotes').insert({
    project_id: req.params.id, client_id: clientId,
    number, currency: clean(req.body.currency || 'CLP', 3).toUpperCase(),
    valid_until: req.body.validUntil || null, notes: clean(req.body.notes), created_by: req.user.id
  }).select().single();
  if (error) return fail(res, 400, error.message);
  const rows = items.map((item, position) => ({
    quote_id: quote.id, position, description: clean(item.description, 240),
    quantity: Number(item.quantity || 1), unit_price: Number(item.unitPrice || 0), tax_rate: Number(item.taxRate || 0)
  }));
  if (rows.some(item => !item.description || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isSafeInteger(item.unit_price) || item.unit_price < 0 || !Number.isFinite(item.tax_rate) || item.tax_rate < 0 || item.tax_rate > 100)) {
    await supabase.from('tshow_quotes').delete().eq('id', quote.id);
    return fail(res, 400, 'Uno o más ítems de la cotización no son válidos.');
  }
  const inserted = await supabase.from('tshow_quote_items').insert(rows).select();
  if (inserted.error) {
    await supabase.from('tshow_quotes').delete().eq('id', quote.id);
    return fail(res, 400, inserted.error.message);
  }
  await audit(req.params.id, req.user.id, 'quote.created', { quoteId: quote.id });
  res.status(201).json({ success: true, data: { ...quote, items: inserted.data } });
});

router.get('/projects/:id/contracts', requireSupabaseAuth, async (req, res) => {
  if (!await projectAccess(req, req.params.id)) return fail(res, 403, 'No tienes acceso a los contratos.');
  const { data, error } = await supabase.from('tshow_contracts').select('*')
    .eq('project_id', req.params.id).order('created_at', { ascending: false });
  return error ? fail(res, 500, error.message) : res.json({ success: true, data: data || [] });
});

router.post('/projects/:id/contracts', requireSupabaseAuth, async (req, res) => {
  const access = await projectAccess(req, req.params.id, true);
  if (!access) return fail(res, 403, 'No tienes permiso para crear contratos.');
  const title = clean(req.body.title, 180);
  const value = req.body.valueAmount === null || req.body.valueAmount === undefined ? null : Number(req.body.valueAmount);
  if (title.length < 2 || (value !== null && (!Number.isSafeInteger(value) || value < 0))) return fail(res, 400, 'Título y monto válido son obligatorios.');
  const clientId = validUuid(req.body.clientId) ? req.body.clientId : null;
  if (clientId && !await directoryRecordBelongs('tshow_clients', clientId, access.project.organization_id)) return fail(res, 400, 'El cliente no pertenece a la organización del evento.');
  const { data, error } = await supabase.from('tshow_contracts').insert({
    project_id: req.params.id, client_id: clientId,
    title, value_amount: value, expires_at: req.body.expiresAt || null,
    file_key: clean(req.body.fileKey, 500) || null, created_by: req.user.id
  }).select().single();
  if (error) return fail(res, 400, error.message);
  await audit(req.params.id, req.user.id, 'contract.created', { contractId: data.id });
  res.status(201).json({ success: true, data });
});

router.get('/organizations/:organizationId/calendar-events', requireSupabaseAuth, async (req, res) => {
  if (!await organizationAccess(req, req.params.organizationId)) return fail(res, 403, 'No tienes acceso al calendario.');
  const { data, error } = await supabase.from('tshow_calendar_events').select('*')
    .eq('organization_id', req.params.organizationId).order('starts_at');
  return error ? fail(res, 500, error.message) : res.json({ success: true, data: data || [] });
});

router.post('/organizations/:organizationId/calendar-events', requireSupabaseAuth, async (req, res) => {
  if (!await organizationAccess(req, req.params.organizationId, true)) return fail(res, 403, 'No tienes permiso para editar el calendario.');
  const startsAt = new Date(req.body.startsAt);
  const endsAt = new Date(req.body.endsAt);
  const title = clean(req.body.title, 180);
  if (title.length < 2 || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return fail(res, 400, 'Título y rango de fechas válido son obligatorios.');
  const projectId = validUuid(req.body.projectId) ? req.body.projectId : null;
  if (projectId) {
    const access = await projectAccess(req, projectId, true);
    if (!access || access.project.organization_id !== req.params.organizationId) return fail(res, 403, 'El evento no pertenece a esta organización.');
  }
  const { data, error } = await supabase.from('tshow_calendar_events').insert({
    organization_id: req.params.organizationId, project_id: projectId, title,
    event_type: clean(req.body.eventType || 'meeting', 60), starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(), location: clean(req.body.location, 240),
    description: clean(req.body.description), created_by: req.user.id
  }).select().single();
  return error ? fail(res, 400, error.message) : res.status(201).json({ success: true, data });
});

module.exports = router;
