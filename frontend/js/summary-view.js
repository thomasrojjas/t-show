/* Read-only overview; every asynchronous result belongs to one view generation. */
const SummaryView = (() => {
    let generation = 0, timer, context, running = false;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const markup = () => `<header class="shell-page-head compact-page-head"><div class="shell-page-head-copy"><span class="shell-eyebrow">Resumen del evento</span><h1 id="overviewTitle">Cargando evento…</h1><p id="overviewIdentity"></p></div><div class="shell-page-actions"><button class="btn btn-primary" data-go="schedule">Abrir escaleta</button><a class="btn btn-secondary" id="summaryLiveLink">Operación en vivo</a></div></header>
      <div id="overviewError" role="status"></div><section class="overview-times" id="overviewTimes" aria-label="Horarios clave"></section>
      <div class="overview-grid"><section class="panel overview-section"><h2>Estado de ejecución</h2><div id="overviewLive" aria-live="polite">Consultando sesión…</div></section>
      <section class="panel overview-section"><h2>Preparación de la pauta</h2><div id="overviewPreparation"></div></section>
      <section class="panel overview-section"><h2>Por revisar</h2><div id="overviewReview"></div><button class="btn btn-secondary" data-summary-edit>Editar datos del evento</button></section>
      <section class="panel overview-section"><h2>Equipo</h2><div id="overviewTeam" aria-live="polite">Consultando equipo…</div><button class="btn btn-secondary" data-go="team">Abrir equipo</button></section></div>`;
    function set(id, html) { const node = document.getElementById(id); if (node && node.innerHTML !== html) node.innerHTML = html; }
    function stop() { generation++; clearInterval(timer); timer = null; context = null; running = false; }
    function renderPreparation(project) {
        const result = TimingEngine.computeSchedule(project, project.blocks || []);
        document.querySelector('[data-summary-edit]').hidden = !['owner','admin'].includes(project.permission);
        const blocks = [...new Map((project.blocks || []).map((b,i) => [b.id || 'legacy:'+i,b])).values()];
        const scripts = blocks.filter(b => String(b.animator_script || '').trim()).length;
        const notes = blocks.filter(b => String(b.notes || '').trim()).length;
        document.getElementById('overviewTitle').textContent = project.eventName || 'Evento';
        document.getElementById('overviewIdentity').textContent = [
            project.eventDate ? new Date(project.eventDate+'T12:00:00').toLocaleDateString('es-CL') : 'Fecha por definir',
            project.location || 'Ubicación por definir',
            {concert:'Concierto',festival:'Festival',corporate:'Corporativo',ceremony:'Ceremonia',broadcast:'Transmisión',other:'Otro'}[project.projectType] || 'Tipo por definir'
        ].join(' · ');
        const nextDay = result.endDate.toDateString() !== result.convDate.toDateString();
        const metrics = result.metrics;
        set('overviewTimes', [['Convocatoria',metrics.convocatoriaTimeFormatted],['Puertas',metrics.doorsTimeFormatted],['Inicio del show',metrics.showStartTimeFormatted],['Término previsto',metrics.endTimeFormatted+(nextDay?' · día siguiente':'')],['Duración total',metrics.totalDurationFormatted]].map(([label,value])=>`<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join(''));
        set('overviewPreparation', `<dl class="overview-facts"><div><dt>Bloques en la escaleta</dt><dd>${result.tableRows.length}</dd></div><div><dt>Bloques editables con guion</dt><dd>${scripts} de ${blocks.length}</dd></div><div><dt>Bloques editables con notas</dt><dd>${notes} de ${blocks.length}</dd></div></dl><button class="btn btn-secondary" data-go="notes">Consultar guiones</button>`);
        const review = [];
        if (!project.eventDate) review.push('Fecha del evento por definir.');
        if (!project.location) review.push('Ubicación por definir.');
        if (!blocks.length) review.push('<button class="overview-link" data-go="schedule">Añadir bloques a la escaleta</button>');
        const missing = blocks.filter(b => b.type === 'ANIMACIÓN' && !String(b.animator_script || '').trim()).length;
        if (missing) review.push(`<button class="overview-link" data-go="notes">${missing} bloque(s) de animación sin guion</button>`);
        set('overviewReview', review.length ? '<ul>'+review.map(x=>'<li>'+x+'</li>').join('')+'</ul>' : '<p>No hay observaciones en los datos revisados.</p>');
    }
    async function refreshLive(token) {
        if (!context || token !== generation || document.hidden || running) return;
        const ctx = context; running = true;
        try {
            const result = await Auth.api('/api/projects/'+encodeURIComponent(ctx.project.id)+'/live');
            if (token !== generation) return;
            const snapshot = LiveEngine.computeLiveSnapshot(ctx.project,result.data || {},result.serverNow ? Date.parse(result.serverNow) : Date.now());
            const labels = {idle:'En espera',live:'En vivo',paused:'Pausado',finished:'Finalizado'};
            const currentLabel = snapshot.status==='idle'?'Primer bloque previsto':snapshot.scheduleEnded?'Último bloque previsto':snapshot.waiting?'Próximo inicio previsto':'Bloque actual';
            const cue = row => row ? esc(row.start+' · '+row.title) : 'Sin bloques';
            set('overviewLive', `<p class="overview-state">${labels[snapshot.status] || 'No disponible'} <small>${snapshot.trackingMode==='manual'?'Manual':'Según horario'}</small></p>${snapshot.scheduleEnded?'<p>Horario concluido</p>':''}<dl class="overview-cues"><dt>${currentLabel}</dt><dd>${cue(snapshot.currentItem)}</dd><dt>Siguiente</dt><dd>${snapshot.nextItem?cue(snapshot.nextItem):'Sin siguiente bloque'}</dd></dl><small>Estado consultado a las ${esc(new Date().toLocaleTimeString('es-CL'))}</small>`);
        } catch (_) { if (token===generation) set('overviewLive','<p>No disponible. No se pudo consultar la sesión.</p><button class="btn btn-secondary" data-summary-retry="live">Reintentar</button>'); }
        finally { if(token===generation) running=false; }
    }
    async function refreshTeam(token) {
        if (!context) return;
        const project = context.project, manage = ['owner','admin'].includes(project.permission);
        const base = '/api/projects/'+encodeURIComponent(project.id);
        const results = await Promise.allSettled([Auth.api(base+'/members'),manage ? Auth.api(base+'/invitations') : Promise.resolve(null)]);
        if(token!==generation) return;
        const members = results[0], invites = results[1];
        const memberText = members.status==='fulfilled' ? (members.value.data || []).length+' miembros' : 'Miembros: no disponible';
        const inviteText = !manage ? '' : invites.status==='fulfilled' ? (invites.value.data || []).filter(i=>(i.effective_status || i.status)==='pending').length+' invitaciones pendientes' : 'Invitaciones: no disponible';
        set('overviewTeam',`<p>${memberText}</p><p>${inviteText}</p><small>Tu permiso: ${{owner:'Propietario',admin:'Administrador',editor:'Director',viewer:'Observador'}[project.permission] || 'Solo lectura'}</small>${results.some(r=>r.status==='rejected')?'<button class="btn btn-secondary" data-summary-retry="team">Reintentar</button>':''}`);
    }
    async function start(project) {
        stop(); const token=generation;
        context={project};
        set('overviewError',''); set('overviewLive','Consultando sesión…'); set('overviewTeam','Consultando equipo…');
        try {
            // Unsaved editor values are used for preparation only, never for shared execution.
            const draft = window.app?.currentProjectId === project.id ? {...project,...window.app.getFormData()} : project;
            renderPreparation(draft);
        } catch (_) { set('overviewError','No se pudo calcular la pauta. Revisa la Escaleta.'); }
        timer=setInterval(()=>refreshLive(token),15000);
        await Promise.allSettled([refreshLive(token),refreshTeam(token)]);
    }
    document.addEventListener('click',event=>{
        const retry=event.target.closest('[data-summary-retry]');
        if(retry) retry.dataset.summaryRetry==='team'?refreshTeam(generation):refreshLive(generation);
    });
    window.addEventListener('focus',()=>refreshLive(generation));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLive(generation);});
    return {markup,start,stop};
})();
