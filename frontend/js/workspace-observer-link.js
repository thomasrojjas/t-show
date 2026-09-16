(() => {
  const sync = () => {
    const heading = [...document.querySelectorAll('#view-team .panel-title')].find(node => node.querySelector('h2')?.textContent.trim() === 'Miembros actuales');
    if (!heading) return;
    let button = document.getElementById('shellObserverShare');
    if (!button) {
      button = document.createElement('a'); button.id = 'shellObserverShare'; button.className = 'btn btn-secondary'; button.textContent = 'Compartir como observador';
      const actions = heading.querySelector('.shell-actions') || heading.appendChild(Object.assign(document.createElement('div'), { className:'shell-actions' }));
      actions.insertBefore(button, actions.firstChild);
    }
    const project = new URLSearchParams(location.search).get('project');
    const role = document.getElementById('workspaceUserRole')?.textContent.trim();
    const manageable = ['Propietario','Administrador'].includes(role);
    button.hidden = !project || !manageable; button.href = project ? `live.html?project=${encodeURIComponent(project)}&observer=1` : 'live.html';
  };
  new MutationObserver(sync).observe(document.body, { childList:true, subtree:true, characterData:true });
  addEventListener('popstate', sync); setInterval(sync, 700); sync();
})();
