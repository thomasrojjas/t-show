(async () => {
  const profile = await Auth.requireGlobalRole(['platform_admin']); if (!profile) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const message = document.getElementById('message');
  const accountMessage = document.getElementById('accountMessage');
  document.getElementById('whoami').textContent = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
  const show = (node, text, error = false) => { node.textContent = text; node.style.display = 'block'; node.className = error ? 'auth-error' : 'auth-success'; };
  async function loadPlans() {
    try {
      const result = await Auth.api('/api/admin/plans');
      document.getElementById('plans').innerHTML = (result.data || []).map(plan => `<form data-id="${esc(plan.id)}" class="auth-form" style="margin-bottom:16px"><strong>${esc(plan.name)} · ${plan.interval === 'month' ? 'Mensual' : 'Anual'}</strong><div class="form-row"><input class="form-control" name="name" value="${esc(plan.name)}"><input class="form-control" name="amount" type="number" min="1" placeholder="Precio CLP" value="${plan.amount_clp || ''}"><input class="form-control" name="limit" type="number" min="1" placeholder="Límite de proyectos" value="${plan.project_limit || ''}"></div><label><input name="active" type="checkbox" ${plan.active ? 'checked' : ''}> Disponible para vender</label><button class="btn btn-primary">Guardar plan</button></form>`).join('') || '<p>No hay planes configurados.</p>';
      document.querySelectorAll('#plans form').forEach(form => form.addEventListener('submit', async event => { event.preventDefault(); const data = new FormData(form); try { await Auth.api(`/api/admin/plans/${form.dataset.id}`, { method: 'PUT', body: JSON.stringify({ name: data.get('name'), amount_clp: data.get('amount') ? Number(data.get('amount')) : null, project_limit: data.get('limit') ? Number(data.get('limit')) : null, active: data.get('active') === 'on' }) }); show(message, 'Plan actualizado.'); } catch (error) { show(message, error.message, true); } }));
    } catch (error) { show(message, error.message, true); }
  }
  async function loadAccounts() {
    try {
      const q = document.getElementById('accountSearch').value.trim();
      const result = await Auth.api(`/api/admin/accounts${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      document.getElementById('accounts').innerHTML = (result.data || []).map(account => `<form data-id="${esc(account.id)}" class="auth-form" style="margin:18px 0;border-top:1px solid #303544;padding-top:14px"><strong>${esc(`${account.first_name || ''} ${account.last_name || ''}`.trim() || account.email)}</strong><small style="display:block">${esc(account.email)} · ${account.ownedCount} proyectos · ${account.limit === null ? 'ilimitados' : `${account.remaining} disponibles`}</small><div class="form-row"><select class="form-control" name="plan"><option value="free" ${account.plan==='free'?'selected':''}>Gratuita</option><option value="pro" ${account.plan==='pro'?'selected':''}>Pro</option><option value="max" ${account.plan==='max'?'selected':''}>Max</option><option value="enterprise" ${account.plan==='enterprise'?'selected':''}>Empresa</option></select><input class="form-control" name="customLimit" type="number" min="1" placeholder="Límite personalizado" value="${account.customLimit || ''}"><select class="form-control" name="status"><option value="free" ${account.status==='free'?'selected':''}>Gratuita</option><option value="active" ${account.status==='active'?'selected':''}>Activa</option><option value="read_only" ${account.status==='read_only'?'selected':''}>Solo lectura</option><option value="cancelled" ${account.status==='cancelled'?'selected':''}>Cancelada</option></select></div><button class="btn btn-primary">Guardar cupo</button></form>`).join('') || '<p>No se encontraron cuentas.</p>';
      document.querySelectorAll('#accounts form').forEach(form => form.addEventListener('submit', async event => { event.preventDefault(); const data = new FormData(form); try { await Auth.api(`/api/admin/accounts/${form.dataset.id}/entitlement`, { method: 'PATCH', body: JSON.stringify({ plan: data.get('plan'), customLimit: data.get('customLimit') ? Number(data.get('customLimit')) : null, status: data.get('status') }) }); show(accountMessage, 'Nivel y cupo actualizados.'); await loadAccounts(); } catch (error) { show(accountMessage, error.message, true); } }));
    } catch (error) { show(accountMessage, error.message, true); }
  }
  document.getElementById('accountRefresh').addEventListener('click', loadAccounts);
  document.getElementById('accountSearch').addEventListener('keydown', event => { if (event.key === 'Enter') loadAccounts(); });
  await Promise.all([loadPlans(), loadAccounts()]);
})();
