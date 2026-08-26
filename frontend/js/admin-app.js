(async () => {
  const profile = await Auth.requireGlobalRole(['platform_admin']); if (!profile) return;
  document.getElementById('whoami').textContent = `${profile.first_name} ${profile.last_name}`;
  const message = document.getElementById('message');
  async function load() {
    const { data, error } = await (await Auth.client()).from('tshow_plans').select('*').order('interval');
    if (error) { message.textContent = error.message; message.style.display = 'block'; return; }
    document.getElementById('plans').innerHTML = data.map(plan => `<form data-id="${plan.id}" class="auth-form" style="margin-bottom:16px"><strong>${plan.interval === 'month' ? 'Mensual' : 'Anual'}</strong><div class="form-row"><input class="form-control" name="name" value="${plan.name}"><input class="form-control" name="amount" type="number" min="1" placeholder="Precio CLP" value="${plan.amount_clp || ''}"></div><label><input name="active" type="checkbox" ${plan.active ? 'checked' : ''}> Disponible para vender</label><button class="btn btn-primary">Guardar</button></form>`).join('');
    document.querySelectorAll('#plans form').forEach(form => form.addEventListener('submit', async e => { e.preventDefault(); const f = new FormData(form); try { await Auth.api(`/api/admin/plans/${form.dataset.id}`, { method: 'PUT', body: JSON.stringify({ name: f.get('name'), amount_clp: Number(f.get('amount')), active: f.get('active') === 'on', benefits: [] }) }); message.textContent = 'Plan actualizado.'; message.style.display = 'block'; } catch (err) { message.textContent = err.message; message.style.display = 'block'; } }));
  }
  load();
})();
