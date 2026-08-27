(function(){
  const routes=['summary','schedule','team','files','settings'];
  const labels={summary:'Resumen',schedule:'Escaleta',team:'Equipo',files:'Archivos',settings:'Configuración'};
  let currentRoute='summary';
  let currentProject=new URLSearchParams(location.search).get('project')||'';
  let currentProjectName='Proyecto activo';
  let views={};

  function routeFromLocation(){
    const clean=location.pathname.split('/').pop().replace('.html','');
    const queryView=new URLSearchParams(location.search).get('view');
    if(routes.includes(clean)) return clean;
    if(routes.includes(queryView)) return queryView;
    return 'summary';
  }

  function routeUrl(route){
    const q=currentProject?`?project=${encodeURIComponent(currentProject)}`:'';
    return `/${route}${q}`;
  }

  function makeView(id,html){
    const section=document.createElement('section'); section.id=`view-${id}`; section.className='workspace-view'; section.dataset.route=id; section.innerHTML=html; return section;
  }

  function mountBackground(){
    window.AmbientBackground?.mount({mode:'workspace'});
  }

  function mountNav(){
    const nav=document.createElement('nav'); nav.className='workspace-nav'; nav.setAttribute('aria-label','Navegación del proyecto');
    nav.innerHTML=`<a class="workspace-nav-brand" href="/summary" data-route="summary">T-SHOW</a><span class="workspace-nav-project" id="navProjectName">${currentProjectName}</span><div class="workspace-nav-tabs">${routes.map(r=>`<a href="/${r}" data-route="${r}">${labels[r]}</a>`).join('')}<a class="workspace-nav-live" id="shellLiveLink" href="live.html">Modo en vivo</a></div><button class="workspace-nav-account" type="button" onclick="Auth.logout()">Salir</button>`;
    document.body.prepend(nav);
    nav.addEventListener('click',event=>{const link=event.target.closest('[data-route]');if(!link)return;event.preventDefault();navigate(link.dataset.route,true);});
    nav.querySelector('[data-route="schedule"]').addEventListener('pointerenter',()=>views.schedule?.querySelector('.timing-table'));
  }

  function mountViews(){
    const shell=document.createElement('main'); shell.className='workspace-shell';
    const schedule=makeView('schedule','');
    ['.header-bar','.main-grid','body > footer'].forEach(selector=>{const node=document.querySelector(selector);if(node)schedule.appendChild(node);});
    views.schedule=schedule;
    views.summary=makeView('summary',`<div class="shell-hero"><article class="glass-panel"><span class="shell-eyebrow">Centro de operación</span><h1>Todo el show.<br>En su momento.</h1><p class="shell-muted">Consulta el estado del evento y entra a la escaleta sin interrumpir tu flujo.</p><div class="shell-actions"><button class="btn btn-primary" data-go="schedule">Abrir escaleta</button><a class="btn btn-secondary" id="summaryLiveLink" href="live.html">Modo en vivo</a></div></article><article class="glass-panel"><span class="shell-eyebrow">Estado</span><h2 id="summaryProjectTitle">Proyecto activo</h2><p id="summaryStatus" class="shell-muted">Sincronizando con el servidor…</p><div class="now-next-card"><span class="shell-eyebrow">Próximo bloque</span><strong id="summaryNext">Selecciona un proyecto</strong></div></article></div><article class="glass-panel shell-projects"><div class="panel-title"><span>Proyectos recientes</span><span id="shellSync" class="shell-muted">Cargando…</span></div><div id="shellProjects"><div class="shell-skeleton"></div><div class="shell-skeleton"></div></div></article>`);
    views.team=makeView('team',`<article class="glass-panel shell-projects"><div class="panel-title"><span>Equipo del proyecto</span><button class="btn btn-primary" id="shellInvite">Invitar persona</button></div><p id="shellTeamStatus" class="shell-muted">Selecciona un proyecto para gestionar su equipo.</p><div id="shellMembers"></div></article>`);
    views.files=makeView('files',`<article class="glass-panel shell-projects"><div class="panel-title"><span>Archivos del proyecto</span></div><p class="shell-muted">Carga segura mediante Cloudflare R2. Tamaño máximo: 10 MB.</p><label class="shell-eyebrow" for="shellFile">Seleccionar archivo</label><input id="shellFile" class="form-control" type="file" accept="image/*,application/pdf,.doc,.docx,.csv"><p id="shellFileStatus" class="shell-message">Esperando un archivo.</p></article>`);
    views.settings=makeView('settings',`<article class="glass-panel shell-projects"><div class="panel-title"><span>Configuración del evento</span></div><p class="shell-muted">Los horarios y parámetros se mantienen conectados con la escaleta.</p><div class="grid-2"><div class="form-group"><label class="form-label" for="shellEventName">Nombre del evento</label><input id="shellEventName" class="form-control" type="text"></div><div class="form-group"><label class="form-label">Proyecto</label><div id="shellProjectId" class="shell-message">Sin proyecto seleccionado</div></div></div><div class="shell-actions"><button class="btn btn-primary" id="shellApplySettings">Guardar nombre</button><button class="btn btn-secondary" data-go="schedule">Editar horarios en escaleta</button><button class="btn btn-secondary" id="shellExport">Exportar JSON</button><button class="btn btn-secondary" id="shellPrint">Imprimir / PDF</button></div></article>`);
    routes.forEach(r=>shell.appendChild(views[r])); document.body.appendChild(shell);
    shell.addEventListener('click',event=>{const go=event.target.closest('[data-go]');if(go){event.preventDefault();navigate(go.dataset.go,true);}const project=event.target.closest('[data-project]');if(project){event.preventDefault();setProject(project.dataset.project,project.dataset.name);navigate('schedule',true);window.app?.loadProject(currentProject);}});
  }

  async function loadSummary(){
    const box=document.getElementById('shellProjects'),sync=document.getElementById('shellSync'); if(!box)return;
    try{const result=await ApiClient.getAllProjects();const projects=Object.values(result.data||{});sync.textContent='Servidor sincronizado';box.innerHTML=projects.length?projects.map(p=>`<div class="shell-project-row"><a href="#" data-project="${p.id}" data-name="${String(p.eventName||'Proyecto').replace(/"/g,'&quot;')}">${p.eventName||'Proyecto sin nombre'}</a><span class="shell-muted">${p.updatedAt?new Date(p.updatedAt).toLocaleDateString('es-CL'):''}</span></div>`).join(''):'<p class="shell-muted">No hay proyectos disponibles.</p>';if(currentProject){const p=projects.find(item=>item.id===currentProject);if(p){currentProjectName=p.eventName;updateProjectUI();}}}catch(error){sync.textContent='Sin conexión';box.innerHTML=`<div class="shell-message">${error.message||'No se pudieron cargar los proyectos.'}</div>`;}
  }

  async function loadTeam(){
    const status=document.getElementById('shellTeamStatus'),box=document.getElementById('shellMembers');if(!currentProject){status.textContent='Selecciona un proyecto desde Resumen.';box.innerHTML='';return;}
    try{const result=await Auth.api(`/api/projects/${encodeURIComponent(currentProject)}/members`);status.textContent='Colaboradores y permisos del proyecto.';box.innerHTML=(result.data||[]).map(m=>`<div class="shell-project-row"><span>${m.profiles?.first_name||''} ${m.profiles?.last_name||m.profiles?.email||''}</span><span class="shell-muted">${m.role==='editor'?'Director':'Observador'}</span></div>`).join('')||'<p class="shell-muted">Sin colaboradores todavía.</p>';}catch(error){status.textContent=error.message;}
  }

  function updateProjectUI(){
    const name=document.getElementById('navProjectName');if(name)name.textContent=currentProjectName;
    ['shellLiveLink','summaryLiveLink'].forEach(id=>{const link=document.getElementById(id);if(link)link.href=currentProject?`live.html?project=${encodeURIComponent(currentProject)}`:'live.html';});
    const title=document.getElementById('summaryProjectTitle');if(title)title.textContent=currentProjectName;
    const status=document.getElementById('summaryStatus');if(status)status.textContent=currentProject?'Proyecto listo para operar.':'Selecciona un proyecto reciente.';
    const input=document.getElementById('shellEventName');if(input)input.value=currentProjectName==='Proyecto activo'?'':currentProjectName;
    const pid=document.getElementById('shellProjectId');if(pid)pid.textContent=currentProject||'Sin proyecto seleccionado';
  }

  function setProject(id,name){currentProject=id||'';currentProjectName=name||currentProjectName;updateProjectUI();history.replaceState({route:currentRoute},'',routeUrl(currentRoute));}

  function setSchedulePreview(rows){const next=document.getElementById('summaryNext');if(!next)return;const first=(rows||[])[0];next.textContent=first?`${first.start} · ${first.title}`:'No hay bloques configurados';}

  async function navigate(route,push){
    if(!routes.includes(route))route='summary';const old=views[currentRoute];if(old&&old!==views[route]){old.classList.remove('is-active');old.classList.add('is-leaving');setTimeout(()=>old.classList.remove('is-leaving'),150);}currentRoute=route;views[route].classList.add('is-active');document.querySelectorAll('.workspace-nav [data-route]').forEach(a=>a.toggleAttribute('aria-current',a.dataset.route===route));document.title=`T-Show · ${labels[route]}`;if(push)history.pushState({route},'',routeUrl(route));if(route==='summary')await loadSummary();if(route==='team')await loadTeam();updateProjectUI();scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }

  function bindActions(){
    document.getElementById('shellInvite').onclick=async()=>{if(!currentProject)return;const email=prompt('Correo de la persona a invitar');if(!email)return;const role=confirm('¿Tendrá permisos de edición?')?'editor':'viewer';try{await Auth.api(`/api/projects/${encodeURIComponent(currentProject)}/invitations`,{method:'POST',body:JSON.stringify({email,role})});await loadTeam();}catch(error){document.getElementById('shellTeamStatus').textContent=error.message;}};
    document.getElementById('shellFile').onchange=async event=>{const file=event.target.files[0],status=document.getElementById('shellFileStatus');if(!file||!currentProject)return;if(file.size>10*1024*1024){status.textContent='El archivo supera 10 MB.';return;}try{status.textContent='Preparando carga segura…';const signed=await Auth.api('/api/uploads/sign',{method:'POST',body:JSON.stringify({scope:'project',projectId:currentProject,contentType:file.type,size:file.size})});await fetch(signed.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file});status.textContent='Archivo cargado correctamente.';}catch(error){status.textContent=error.message||'No se pudo cargar el archivo.';}};
    document.getElementById('shellApplySettings').onclick=()=>{const value=document.getElementById('shellEventName').value.trim();if(value&&document.getElementById('eventName')){document.getElementById('eventName').value=value;currentProjectName=value;window.app?.calculateTiming();updateProjectUI();}};
    document.getElementById('shellExport').onclick=()=>window.app?.exportCurrentProjectJSON();document.getElementById('shellPrint').onclick=()=>window.app?.print();
    addEventListener('popstate',()=>{currentProject=new URLSearchParams(location.search).get('project')||currentProject;navigate(routeFromLocation(),false);});
  }

  function init(){mountBackground();mountNav();mountViews();bindActions();currentRoute=routeFromLocation();routes.forEach(r=>views[r].classList.remove('is-active'));navigate(currentRoute,false);}
  window.WorkspaceShell={navigate,setProject,setSchedulePreview,get projectId(){return currentProject;}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
