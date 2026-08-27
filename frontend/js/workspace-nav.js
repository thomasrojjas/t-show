(function(){
  const page = document.body?.dataset?.workspacePage || 'summary';
  const project = new URLSearchParams(location.search).get('project');
  const projectQuery = project ? `?project=${encodeURIComponent(project)}` : '';
  const links = [
    ['summary.html','Resumen','summary'], ['schedule.html','Escaleta','schedule'],
    ['team.html','Equipo','team'], ['files.html','Archivos','files'], ['settings.html','Configuración','settings']
  ];
  function mount(){
    const existing=document.querySelector('.workspace-nav'); if(existing) return;
    const nav=document.createElement('nav'); nav.className='workspace-nav'; nav.setAttribute('aria-label','Navegación del proyecto');
    nav.innerHTML=`<a class="workspace-nav-brand" href="summary.html${projectQuery}">T-SHOW</a><span class="workspace-nav-project" id="navProjectName">Proyecto activo</span><div class="workspace-nav-tabs">${links.map(([href,label,key])=>`<a href="${href}${projectQuery ? (href.includes('?')?'&':'?')+projectQuery.slice(1):''}" ${page===key?'aria-current="page"':''}>${label}</a>`).join('')}<a class="workspace-nav-tabs workspace-nav-live" href="live.html${projectQuery}">Modo en vivo</a></div><button class="workspace-nav-account" type="button" onclick="Auth.logout()">Salir</button>`;
    document.body.prepend(nav);
    const title=document.getElementById('displayEventTitle')||document.getElementById('eventName');
    const target=document.getElementById('navProjectName'); if(target&&title) target.textContent=title.value||title.textContent||'Proyecto activo';
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
