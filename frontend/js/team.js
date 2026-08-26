const TeamManager = (() => {
  const status = () => document.getElementById('teamStatus');
  async function load() {
    const id = window.app?.currentProjectId;
    if (!id) return;
    try {
      const result = await Auth.api(`/api/projects/${encodeURIComponent(id)}/members`);
      document.getElementById('teamMembers').innerHTML = (result.data || []).map(member => `<div class="project-chip"><span>${member.profiles?.first_name || ''} ${member.profiles?.last_name || ''} · ${member.role === 'editor' ? 'Director' : 'Observador'}</span></div>`).join('') || '<small>Sin colaboradores todavía.</small>';
      status().textContent = 'Los colaboradores acceden solo con sus permisos.';
    } catch (error) { status().textContent = error.message; }
  }
  async function invite() {
    const id = window.app?.currentProjectId;
    if (!id) return PrintExportManager.showToast('Guarda el proyecto antes de invitar.', 'warning');
    const email = window.prompt('Correo de la persona a invitar:');
    if (!email) return;
    const role = window.confirm('¿Tendrá permisos de edición? Aceptar = Director, Cancelar = Observador.') ? 'editor' : 'viewer';
    try { await Auth.api(`/api/projects/${encodeURIComponent(id)}/invitations`, { method: 'POST', body: JSON.stringify({ email, role }) }); PrintExportManager.showToast('Invitación enviada.', 'success'); load(); } catch (error) { PrintExportManager.showToast(error.message, 'danger'); }
  }
  window.setInterval(load, 2500);
  return { load, invite };
})();
