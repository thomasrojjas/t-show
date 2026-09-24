/* Production console: persistent DOM, local reading state, server-confirmed actions. */
class LiveApp {
    constructor() {
        this.projectId = new URLSearchParams(location.search).get('project');
        document.body.dataset.projectId = this.projectId || '';
        this.state = LiveEngine.defaults(); this.version = 0; this.projectVersion = 0; this.rows = new Map();
        this.connected = false; this.busy = false; this.follow = true; this.tab = 'script'; this.offset = 0;
        this.permission = 'viewer'; this.selection = null; this.readingKey = ''; this.syncing = null;
        this.observerPass = null;
        this.bind();
        this.init().catch(error => this.message(error.message, true, true));
    }
    $(id) { return document.getElementById(id); }
    text(id, value) { const node = this.$(id); if (!node) return; if (node.textContent !== String(value)) node.textContent = value; }
    now() { return Date.now() + this.offset; }
    get operator() { return ['owner', 'admin', 'editor'].includes(this.permission); }
    get manager() { return ['owner', 'admin'].includes(this.permission); }
    themeDefinitions() {
        return [
            ['light', 'Claro'], ['nocturne', 'Nocturne'], ['violet', 'Violet Studio'],
            ['cobalt', 'Cobalt Stage'], ['ember', 'Ember Cue'], ['emerald', 'Emerald Control'], ['monochrome', 'Monochrome']
        ];
    }
    renderThemeSwitcher() {
        const options = this.$('liveThemeOptions');
        if (!options) return;
        options.innerHTML = '';
        for (const [theme, label] of this.themeDefinitions()) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'live-theme-option'; button.dataset.theme = theme;
            button.setAttribute('aria-label', `${label}. Cambiar tema`); button.title = label;
            button.innerHTML = `<span aria-hidden="true"></span><b>${label}</b>`;
            button.onclick = () => this.applyLiveTheme(theme, true);
            options.appendChild(button);
        }
        this.updateThemeSwitcher();
    }
    updateThemeSwitcher() {
        const current = window.TShowTheme?.current || 'light';
        this.$('liveThemeOptions')?.querySelectorAll('.live-theme-option').forEach(button => {
            const selected = button.dataset.theme === current;
            button.setAttribute('aria-pressed', String(selected));
            button.classList.toggle('is-selected', selected);
        });
    }
    applyLiveTheme(theme, remember = true) {
        document.documentElement.classList.add('live-theme-changing');
        const next = window.TShowTheme?.apply(theme, { persist:false }) || theme;
        if (remember) {
            window.TShowTheme?.rememberLive(next, this.projectId);
            this.liveThemeOverride = true;
        }
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#f3f4f4' : '#101216');
        this.updateThemeSwitcher();
        if (this.project) { document.body.dataset.visualTheme = next; this.render(); }
        window.requestAnimationFrame?.(() => document.documentElement.classList.remove('live-theme-changing'));
    }
    async init() {
        if (!this.projectId) { location.replace('/projects'); return; }
        this.$('backLink').href = `/schedule?project=${encodeURIComponent(this.projectId)}`;
        this.$('productionLink').href = `/production?project=${encodeURIComponent(this.projectId)}`;
        // The bootstrap paints the cached project theme before auth/network work. Keep it
        // active until the complete server identity is confirmed below.
        window.TShowTheme?.apply(window.TShowTheme.current || 'light', { persist:false });
        if (!await Auth.requireSession()) return;
        this.project = await ApiClient.getProject(this.projectId); this.projectVersion = this.project.documentVersion || 0;
        const liveThemes = { light:'#315ea8', nocturne:'#a8c7fa', violet:'#c084fc', cobalt:'#38bdf8', ember:'#ffb340', emerald:'#39ff88', monochrome:'#f2f4f7' };
        const eventTheme = liveThemes[this.project.visualTheme] ? this.project.visualTheme : 'light';
        const localTheme = window.TShowTheme?.liveOverrideFor(this.projectId);
        this.eventTheme = eventTheme; this.liveThemeOverride = Boolean(localTheme);
        const visualTheme = localTheme || eventTheme;
        window.TShowTheme?.apply(visualTheme, { persist:false });
        document.body.dataset.visualTheme = visualTheme;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', visualTheme === 'light' ? '#f3f4f4' : '#101216');
        this.updateThemeSwitcher();
        this.permission = this.project.permission || 'viewer';
        this.$('productionLink').hidden = !this.operator;
        this.text('eventName', this.project.eventName || 'Evento');
        document.title = `T-Show · ${this.project.eventName || 'En vivo'}`;
        this.text('roleLabel', { owner:'Propietario', admin:'Administrador', editor:'Director', viewer:'Solo lectura' }[this.permission] || 'Solo lectura');
        this.text('zoneLabel', LiveEngine.zone(this.project));
        try {
            const size = localStorage.getItem('tshow_live_text_size');
            if (['18', '22', '26'].includes(size)) { this.$('textSize').value = size; this.setTextSize(); }
        } catch (_) { /* Preferences are optional. */ }
        await this.refresh();
        if (new URLSearchParams(location.search).get('observer') === '1' && this.manager) this.openObserver();
        this.timer = setInterval(() => this.render(), 1000);
        this.healthTimer = setInterval(() => this.refresh(), 15000);
        this.listen();
    }
    async listen() {
        try {
            await LiveSync.startListening(this.projectId, result => this.accept(result), status => {
                if (status === 'subscribed') this.refresh();
                else this.connection('reconnecting');
            });
        } catch (_) { this.connection('reconnecting'); }
    }
    connection(status) {
        this.connected = status === 'connected';
        const label = { connected:'Conectado', reconnecting:'Reconectando…', offline:'Sin conexión · reloj estimado' }[status];
        this.text('connectionStatus', label); this.text('stageConnection', label);
        if (this.$('connectionStatus')) this.$('connectionStatus').dataset.state = status;
        if (this.project) this.render();
    }
    accept(result) {
        if ((result.version || 0) < this.version) return;
        const serverNow = result.serverNow ? Date.parse(result.serverNow) : this.now();
        this.state = this.project ? LiveEngine.resolveState(this.project, result.data || {}, serverNow) : LiveEngine.defaults(result.data || {});
        this.version = result.version || 0;
        if (result.serverNow) this.offset = Date.parse(result.serverNow) - Date.now();
        if (result.projectVersion !== undefined) this.projectVersion = Number(result.projectVersion) || 0;
        this.render();
    }
    async refresh() {
        if (!this.project || this.syncing || this.busy) return;
        this.syncing = (async () => {
            try {
                const result = await LiveSync.fetchLiveState(this.projectId);
                if (result.projectVersion !== undefined && Number(result.projectVersion) !== Number(this.projectVersion)) {
                    const refreshedProject = await ApiClient.getProject(this.projectId);
                    this.project = refreshedProject; this.projectVersion = refreshedProject.documentVersion || 0;
                }
                this.accept(result);
                this.connection('connected');
                this.$('retryButton').hidden = true;
            } catch (error) { this.connection('offline'); this.message(error.message + ' Recarga para recuperar el estado.', true, true); }
            finally { this.syncing = null; }
        })();
        return this.syncing;
    }
    message(value, error = false, retry = false) {
        this.$('feedback').hidden = false; this.$('feedback').dataset.error = String(error);
        this.text('feedbackText', value); this.$('retryButton').hidden = !retry;
    }
    confirm(title, description) {
        this.text('confirmTitle', title); this.text('confirmText', description);
        const dialog = this.$('confirmDialog'); dialog.returnValue = 'cancel'; dialog.showModal();
        return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once:true }));
    }
    async execute(command, prompt) {
        if (this.busy || !this.connected || !this.operator) return;
        const expectedVersion = this.version;
        if (prompt && !await this.confirm(prompt[0], prompt[1])) return;
        if (this.busy || !this.connected) return;
        if (this.version !== expectedVersion) {
            this.message('La sesión cambió mientras confirmabas. Revisa el estado antes de repetir la acción.', true);
            return;
        }
        this.busy = true; this.render(); this.message('Guardando cambio…');
        try {
            const result = await LiveSync.pushLiveState(this.projectId, command, expectedVersion, this.projectVersion);
            this.accept(result);
            this.message('Cambio guardado y compartido con el equipo.');
            if (this.state.status === 'finished') this.openReport();
        } catch (error) {
            // A timeout can mean a committed write with a lost response. Never replay it blindly.
            this.connection('offline');
            this.message(error.message + ' Recarga y revisa el estado antes de repetir la acción.', true, true);
        } finally { this.busy = false; this.render(); }
    }
    bind() {
        this.headerObserver = new ResizeObserver(entries => {
            const sticky = getComputedStyle(entries[0].target).position === 'sticky';
            document.documentElement.style.setProperty('--header-height', (sticky ? entries[0].target.getBoundingClientRect().height : 0) + 'px');
        });
        this.headerObserver.observe(document.querySelector('.live-header'));
        this.$('primaryAction').onclick = () => {
            if (this.state.status === 'finished') return this.openReport();
            const action = { idle:'start', live:'pause', paused:'resume' }[this.state.status];
            let prompt;
            if (action === 'resume' && this.state.trackingMode === 'schedule') {
                const target = LiveEngine.computeLiveSnapshot(this.project, { ...this.state, status:'live' }, this.now());
                const current = LiveEngine.computeLiveSnapshot(this.project, this.state, this.now());
                if (target.scheduleEnded || target.currentItem?.key !== current.currentItem?.key)
                    prompt = ['Reanudar según horario', target.scheduleEnded ? 'El horario ya concluyó. Se mostrará la pauta concluida.' : `Continuarás en «${target.currentItem?.title}». El horario original continúa durante la pausa.`];
            }
            this.execute({ action }, prompt);
        };
        this.$('trackingMode').onchange = event => {
            const mode = event.target.value; event.target.value = this.state.trackingMode;
            const target = mode === 'schedule' ? LiveEngine.computeLiveSnapshot(this.project, { ...this.state, status:'live', trackingMode:'schedule' }, this.now()) : null;
            const prompt = this.state.status === 'idle' ? null : ['Cambiar seguimiento', mode === 'manual' ?
                'Conservarás el bloque y su tiempo transcurrido. El avance dependerá del operador.' :
                target.scheduleEnded ? 'El horario original ya concluyó.' : `El horario corresponde a «${target.currentItem?.title || 'sin bloques'}». Al seguir el horario se utilizará ese bloque.`];
            this.execute({ action:'mode', mode }, prompt);
        };
        this.$('scheduleStartButton').onclick = async () => {
            let late = false;
            let schedule;
            try { schedule = LiveEngine.scheduleStart(this.project); late = Date.parse(schedule.startAt) <= this.now(); } catch (_) { /* server returns the validation message */ }
            const exactStart = schedule ? new Intl.DateTimeFormat('es-CL', { timeZone:schedule.zone, dateStyle:'full', timeStyle:'short' }).format(new Date(schedule.startAt)) : 'la fecha y hora configuradas';
            const firstTitle = schedule?.first?.title || 'el primer bloque';
            const prompt = late ? ['Iniciar seguimiento horario ahora', 'La hora programada ya pasó. Se mostrará el bloque correspondiente a este momento, usando la hora del servidor y conservando la pauta.'] :
                ['Programar inicio automático', `Comenzará el ${exactStart}, en «${firstTitle}». La consola puede cerrarse y el estado se resolverá al volver a consultar.`];
            this.execute({ action:'schedule', ...(late ? { startNow:true } : {}) }, prompt);
        };
        this.$('cancelScheduleButton').onclick = () => this.execute({ action:'cancel-schedule' }, ['Cancelar programación', 'El evento volverá a quedar en espera. La escaleta y el historial se conservarán.']);
        this.$('previousButton').onclick = () => this.execute({ action:'previous' });
        this.$('nextButton').onclick = () => this.execute({ action:'next' });
        this.$('extendButton').onclick = () => this.execute({ action:'extend', minutes:Number(this.$('extendMinutes').value) });
        this.$('restartBlock').onclick = () => this.execute({ action:'restart-block' }, ['Reiniciar tiempo del bloque', 'Se registrará el tramo actual y el cronómetro volverá a la duración completa del bloque.']);
        this.$('finishButton').onclick = () => this.execute({ action:'finish' }, ['Finalizar evento', 'La sesión quedará finalizada y conservará los tiempos registrados.']);
        this.$('reopenButton').onclick = () => {
            const target = LiveEngine.computeLiveSnapshot(this.project, { ...this.state, status:'live', trackingMode:'schedule' }, this.now());
            const description = target.scheduleEnded ? 'El horario del proyecto ya concluyó. Revisa la fecha y los horarios en la Escaleta antes de continuar.' :
                `Se seguirá el horario del ${this.project.eventDate || 'evento sin fecha'}, en «${target.currentItem?.title || 'sin bloques'}».`;
            this.execute({ action:'reopen' }, ['Reabrir según horario', `${description} Se conservará el historial, sin reiniciar la sesión. Esto no recupera el avance manual anterior.`]);
        };
        this.$('resetButton').onclick = () => this.execute({ action:'reset' }, ['Reiniciar sesión', 'Se borrarán los tiempos, exclusiones y ajustes de esta sesión. La escaleta original se conserva.']);
        this.$('retryButton').onclick = async () => {
            if (!this.project) { location.reload(); return; }
            await this.refresh(); if (this.connected) { this.message('Sesión recargada. Revisa el bloque actual antes de operar.'); this.listen(); }
        };
        this.$('followLive').onchange = event => { this.follow = event.target.checked; this.render(); };
        this.$('returnCurrent').onclick = () => {
            this.follow = true; this.$('followLive').checked = true; this.render();
            const key = this.snapshot?.currentItem?.key;
            this.rows.get(key)?.element.scrollIntoView({ block:'center', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        };
        this.$('scriptTab').onclick = () => this.selectTab('script');
        this.$('notesTab').onclick = () => this.selectTab('notes');
        this.$('textSize').onchange = () => this.setTextSize();
        this.$('stageButton').onclick = () => {
            const dialog = this.$('stageDialog');
            document.body.classList.add('stage-open');
            dialog.showModal();
            this.render();
        };
        this.$('closeStage').onclick = () => this.$('stageDialog').close();
        this.$('stageDialog').addEventListener('close', () => document.body.classList.remove('stage-open'));
        this.$('stageDialog').addEventListener('cancel', event => {
            event.preventDefault();
            event.currentTarget.close();
            this.$('stageButton').focus();
        });
        this.$('camarinesButton').onclick = () => {
            document.body.classList.add('camarines-open');
            this.$('camarinesDialog').showModal();
            this.render();
        };
        this.$('closeCamarines').onclick = () => this.$('camarinesDialog').close();
        this.$('camarinesDialog').addEventListener('close', () => document.body.classList.remove('camarines-open'));
        this.$('camarinesDialog').addEventListener('cancel', event => {
            event.preventDefault();
            event.currentTarget.close();
            this.$('camarinesButton').focus();
        });
        this.renderThemeSwitcher();
        this.$('reportButton').onclick = () => this.openReport();
        this.$('closeReport').onclick = () => this.$('reportDialog').close();
        this.$('printReport').onclick = () => window.print();
        this.$('fullscreenButton').onclick = async () => {
            try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
            catch (_) { this.message('Este navegador no permite pantalla completa. Puedes seguir usando la consola.', true); }
        };
        document.addEventListener('fullscreenchange', () => this.text('fullscreenButton', document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa'));
        this.$('copyLink').onclick = async () => {
            const url = new URL('/live', location.origin); url.searchParams.set('project', this.projectId);
            try { await navigator.clipboard.writeText(url.href); this.message('Enlace copiado. La persona necesita acceso al proyecto.'); }
            catch (_) { this.message('No se pudo copiar. Copia la dirección desde la barra del navegador.', true); }
        };
        this.$('shareObserver').onclick = () => this.openObserver();
        this.$('closeObserver').onclick = () => this.$('observerDialog').close();
        const observerViewport = () => {
            const dialog = this.$('observerDialog');
            if (!matchMedia('(max-width:767px)').matches) {
                dialog.style.removeProperty('--observer-viewport-height');
                return;
            }
            dialog.style.setProperty('--observer-viewport-height', `${window.visualViewport?.height || innerHeight}px`);
            if (dialog.open && dialog.contains(document.activeElement) && document.activeElement.matches('input,select')) {
                requestAnimationFrame(() => document.activeElement.scrollIntoView({ block:'nearest', behavior:'instant' }));
            }
        };
        window.visualViewport?.addEventListener('resize', observerViewport);
        window.addEventListener('resize', observerViewport);
        observerViewport();
        this.$('observerForm').onsubmit = event => { event.preventDefault(); this.createObserverPass(); };
        this.$('observerCopy').onclick = async () => {
            if (!this.observerPass?.url) return;
            try { await navigator.clipboard.writeText(this.observerPass.url); this.$('observerStatus').textContent = 'Enlace copiado.'; }
            catch (_) { this.$('observerStatus').textContent = 'No se pudo copiar el enlace.'; }
        };
        this.$('observerDownload').onclick = () => {
            if (!this.observerPass?.qr) return;
            const link = document.createElement('a'); link.href = this.observerPass.qr; link.download = 'tshow-observador.png'; link.click();
        };
        document.addEventListener('click', event => { if (!this.$('moreMenu').contains(event.target)) this.$('moreMenu').open = false; });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                this.$('moreMenu').open = false;
                const stage = this.$('stageDialog');
                if (stage?.open) { stage.close(); this.$('stageButton').focus(); return; }
                const camarines = this.$('camarinesDialog');
                if (camarines?.open) { camarines.close(); this.$('camarinesButton').focus(); return; }
            }
            if (event.target.getAttribute('role') === 'tab' && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
                event.preventDefault(); this.selectTab(event.key === 'Home' ? 'script' : event.key === 'End' ? 'notes' : this.tab === 'script' ? 'notes' : 'script');
                this.$(this.tab + 'Tab').focus();
            }
        });
        addEventListener('offline', () => this.connection('offline'));
        addEventListener('online', () => { this.connection('reconnecting'); this.refresh(); this.listen(); });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
        addEventListener('pagehide', () => { LiveSync.stopListening(); clearInterval(this.timer); clearInterval(this.healthTimer); this.headerObserver.disconnect(); });
        addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
    }
    setTextSize() {
        document.documentElement.style.setProperty('--copy-size', this.$('textSize').value + 'px');
        try { localStorage.setItem('tshow_live_text_size', this.$('textSize').value); } catch (_) { /* optional */ }
    }
    selectTab(tab) {
        this.tab = tab;
        for (const name of ['script', 'notes']) {
            this.$(name + 'Tab').setAttribute('aria-selected', String(name === tab));
            this.$(name + 'Tab').tabIndex = name === tab ? 0 : -1;
            this.$(name + 'Panel').hidden = name !== tab;
        }
    }
    openObserver() {
        if (!this.manager) { this.message('Solo el propietario o administrador puede compartir como observador.', true); return; }
        this.$('moreMenu').open = false;
        this.$('observerStatus').textContent = '';
        this.$('observerDialog').showModal();
        const result = this.$('observerResult'), form = this.$('observerForm');
        if (result && form) form.parentNode.insertBefore(result, form);
        this.$('observerDays').value = '1';
        const mobile = matchMedia('(max-width:767px)').matches;
        if (mobile) this.$('closeObserver').focus({ preventScroll:true });
        this.createObserverPass().finally(() => {
            if (!mobile && this.$('observerDialog').open) this.$('observerLabel').focus();
        });
        this.loadObserverPasses();
    }
    async loadObserverPasses() {
        try {
            const result = await Auth.api(`/api/projects/${encodeURIComponent(this.projectId)}/guest-passes`);
            const now = Date.now(), list = (result.data || []).filter(pass => !pass.revoked_at && Date.parse(pass.expires_at) > now);
            this.$('observerActiveList').innerHTML = list.length ? list.map(pass => `<article class="observer-pass"><div><strong>${String(pass.label || 'Observador sin nombre').replace(/[&<>"']/g, '')}</strong><small>${pass.access_mode === 'live' ? 'En vivo' : 'Copia publicada'} · vence ${new Date(pass.expires_at).toLocaleString('es-CL')}</small></div><button type="button" data-revoke-observer="${pass.id}">Revocar</button></article>`).join('') : '<p class="muted">No hay accesos activos.</p>';
            this.$('observerActiveList').querySelectorAll('[data-revoke-observer]').forEach(button => button.onclick = async () => {
                if (!await this.confirm('Revocar acceso', 'La persona dejará de ver el evento en el próximo intento de actualización.')) return;
                button.disabled = true;
                try { await Auth.api(`/api/projects/${encodeURIComponent(this.projectId)}/guest-passes/${encodeURIComponent(button.dataset.revokeObserver)}`, { method:'DELETE' }); this.loadObserverPasses(); this.$('observerStatus').textContent = 'Acceso revocado.'; }
                catch (error) { button.disabled = false; this.$('observerStatus').textContent = error.message || 'No pudimos revocar el acceso.'; }
            });
        } catch (error) { this.$('observerActiveList').innerHTML = `<p class="muted">${String(error.message || 'No se pudieron cargar los accesos.').replace(/[&<>"']/g, '')}</p>`; }
    }
    async createObserverPass() {
        const submit = this.$('observerCreate');
        submit.disabled = true; this.$('observerStatus').dataset.status = 'warning'; this.$('observerStatus').textContent = 'Generando acceso seguro…';
        try {
            const result = await Auth.api(`/api/projects/${encodeURIComponent(this.projectId)}/guest-passes`, {
                method:'POST',
                body:JSON.stringify({
                    accessMode:'live', label:this.$('observerLabel').value.trim(), days:Number(this.$('observerDays').value),
                    visibility:{ date:false, location:false, schedule:false, state:true, notes:false, script:false }
                })
            });
            this.observerPass = { ...(result.data || {}), url:result.url, qr:result.qr, accessMode:result.accessMode };
            this.$('observerQr').src = this.observerPass.qr;
            this.$('observerUrl').textContent = this.observerPass.url;
            this.$('observerResult').hidden = false;
            this.$('observerStatus').dataset.status = 'success'; this.$('observerStatus').textContent = 'Acceso creado. Puedes revocarlo desde Equipo.';
            this.loadObserverPasses();
        } catch (error) {
            this.$('observerStatus').dataset.status = 'error'; this.$('observerStatus').textContent = error.message || 'No pudimos generar el acceso.';
        } finally { submit.disabled = false; }
    }
    createRow(row) {
        const element = document.createElement('article'); element.className = 'cue'; element.dataset.key = row.key;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'cue-select'; button.setAttribute('aria-expanded','false');
        const num = document.createElement('span'); num.className = 'cue-num';
        const time = document.createElement('span'); time.className = 'cue-time';
        const copy = document.createElement('span'); copy.className = 'cue-copy';
        const title = document.createElement('strong'), meta = document.createElement('small');
        const status = document.createElement('span'); status.className = 'cue-state';
        copy.append(title, meta); button.append(num, time, copy, status);
        const extra = document.createElement('div'); extra.className = 'cue-extra'; extra.hidden = true;
        const end = document.createElement('span'), action = document.createElement('button'); action.type = 'button'; action.hidden = true;
        const read = document.createElement('a'); read.href = '#contextTitle'; read.textContent = 'Leer guion y notas';
        extra.append(end, read, action); element.append(button, extra);
        button.onclick = () => {
            this.follow = false; this.$('followLive').checked = false; this.selection = row.key;
            this.render();
        };
        action.onclick = () => {
            const data = this.snapshot.items.find(x => x.key === row.key);
            this.execute({ action: data.isMuted ? 'restore' : 'exclude', key:row.key },
                [data.isMuted ? 'Restaurar bloque' : 'Excluir del seguimiento', `«${data.title}». Este ajuste afecta la sesión en vivo y conserva la escaleta original.`]);
        };
        this.$('rundownRows').appendChild(element);
        const entry = { element, button, num, time, title, meta, status, extra, end, action };
        this.rows.set(row.key, entry); return entry;
    }
    renderCamarines(snap, current, timer, timerLabel, labels) {
        const dialog = this.$('camarinesDialog');
        if (!dialog?.open) return;
        this.text('camarinesTitle', this.project?.eventName || 'En vivo');
        this.text('camarinesStatus', labels[snap.status] || 'En espera');
        this.$('camarinesStatus').dataset.state = snap.status;
        this.text('camarinesCountdown', timer);
        this.$('camarinesCountdown').dataset.alert = snap.alertLevel;
        const countdownLabel = snap.status === 'finished' ? 'Evento finalizado' :
            snap.status === 'scheduled' ? 'Inicio programado' :
            snap.status === 'paused' ? 'Pausado · el tiempo está detenido' :
            snap.isOvertime ? 'Tiempo de atraso del bloque actual' :
            snap.status === 'idle' ? 'Esperando el inicio del seguimiento' : timerLabel;
        this.text('camarinesCountdownLabel', countdownLabel);
        const previousItem = snap.previousItem;
        const nextItem = snap.nextItem;
        const previousTitle = previousItem?.title || (snap.currentItem ? 'Inicio del evento' : 'Sin bloque anterior');
        const previousMeta = previousItem ? `${previousItem.type || 'Bloque'} · ${previousItem.start || 'Inicio programado'}` : (snap.currentItem ? 'Este es el primer bloque en seguimiento.' : 'El seguimiento todavía no ha comenzado.');
        const nextTitle = nextItem?.title || (snap.status === 'finished' ? 'Evento finalizado' : snap.items.length ? 'Sin siguiente bloque' : 'No hay bloques disponibles');
        const nextStart = nextItem && snap.trackingMode === 'manual' && snap.status !== 'idle' && snap.status !== 'finished'
            ? LiveEngine.formatTimeSeconds(this.now() + Math.max(0, snap.remainingSeconds) * 1000, snap.zone).slice(0,5)
            : nextItem?.start;
        const nextMeta = nextItem ? `${nextItem.type || 'Bloque'} · ${nextStart || 'Inicio estimado'}` : (snap.status === 'finished' ? 'El evento terminó.' : 'Después finaliza el evento.');
        this.text('camarinesPreviousTitle', previousTitle);
        this.text('camarinesPreviousMeta', previousMeta);
        this.text('camarinesNextTitle', nextTitle);
        this.text('camarinesNextMeta', nextMeta);
        const startNum = current?.num || 1;
        const remaining = snap.items.filter(row => row.num >= startNum);
        const rows = this.$('camarinesRows');
        rows.innerHTML = remaining.map(row => {
            const state = row === current && ['live','paused'].includes(snap.status) && !snap.waiting && !snap.scheduleEnded ? 'active' : row.rowState;
            const stateLabel = {active:'En curso',future:'Pendiente',completed:'Completado',muted:'Excluido'}[state] || 'Pendiente';
            return `<article class="camarines-row" data-state="${state}"><span class="camarines-row-number">${String(row.num).padStart(2,'0')}</span><div class="camarines-row-copy"><strong>${this.escape(row.title)}</strong><small>${this.escape(row.type || 'Bloque')} · ${row.effectiveDuration} min</small></div><div class="camarines-row-time"><span>${this.escape(row.start || '—')}</span><small>${stateLabel}</small></div></article>`;
        }).join('');
        this.$('camarinesEmpty').hidden = remaining.length > 0;
    }

    render() {
        if (!this.project) return;
        let snap;
        try { snap = LiveEngine.computeLiveSnapshot(this.project, this.state, this.now()); }
        catch (error) { this.message(error.message, true); return; }
        this.snapshot = snap;
        const blocked = !this.connected || this.busy;
        const status = snap.status;
        const labels = { idle:'En espera', scheduled:'Programado', 'schedule-invalidated':'Programación desactualizada', live:snap.scheduleEnded ? 'Horario concluido' : 'En vivo', paused:'Pausado', finished:'Finalizado' };
        this.text('sessionStatus', labels[status]);
        if (this.$('sessionStatus')) this.$('sessionStatus').dataset.state = status;
        this.text('masterClock', LiveEngine.formatTimeSeconds(this.now(), snap.zone));
        const nextCountdown = status !== 'finished' && status !== 'idle' && snap.currentItem
            ? LiveEngine.formatDurationSeconds(Math.max(0, snap.remainingSeconds))
            : status === 'finished' ? 'Finalizado' : '—';
        this.text('nextHeaderCountdown', nextCountdown);
        this.$('trackingMode').value = this.state.trackingMode; this.$('trackingMode').disabled = blocked || !this.operator || ['finished','scheduled','schedule-invalidated'].includes(status);
        this.text('modeHelp', snap.trackingMode === 'schedule' ? 'El horario original continúa durante la pausa.' : 'Al agotarse el tiempo, el bloque continúa hasta avanzar manualmente.');
        const primary = this.$('primaryAction');
        primary.hidden = !this.operator || ['scheduled','schedule-invalidated'].includes(status);
        primary.disabled = status !== 'finished' && (blocked || !snap.executable.length);
        primary.setAttribute('aria-busy', String(this.busy));
        this.text('primaryAction', this.busy ? 'Guardando…' : { idle:matchMedia('(max-width:767px)').matches ? 'Iniciar seguimiento' : '▶ Iniciar seguimiento', live:'Ⅱ Pausar seguimiento', paused:snap.trackingMode === 'schedule' ? '▶ Reanudar según horario' : '▶ Reanudar', finished:'Ver balance' }[status]);
        this.$('manualControls').hidden = !this.operator || snap.trackingMode !== 'manual' || status !== 'live';
        this.$('previousButton').disabled = blocked || !snap.currentItem || snap.currentIndex <= 0;
        for (const id of ['nextButton','extendButton','restartBlock','extendMinutes']) this.$(id).disabled = blocked || !snap.currentItem;
        this.$('nextButton').disabled = blocked || !snap.nextItem;
        this.text('nextButton', snap.nextItem ? 'Siguiente bloque →' : 'Último bloque');
        this.$('finishButton').hidden = !this.manager || !['live','paused'].includes(status);
        this.$('reopenButton').hidden = !this.manager || status !== 'finished';
        this.$('reopenButton').disabled = blocked || !snap.executable.length || !this.project.eventDate;
        this.$('resetButton').hidden = !this.manager || ['live','scheduled'].includes(status);
        this.$('finishButton').disabled = blocked; this.$('resetButton').disabled = blocked;
        this.$('scheduleStartButton').hidden = !this.manager || !['idle','schedule-invalidated'].includes(status);
        this.$('scheduleStartButton').disabled = blocked || !this.project.eventDate || !snap.executable.length;
        this.$('cancelScheduleButton').hidden = !this.manager || !['scheduled','schedule-invalidated'].includes(status);
        this.$('cancelScheduleButton').disabled = blocked;
        const current = snap.currentItem;
        this.text('currentTitle', current?.title || 'Aún no hay bloques');
        this.text('currentContext', status === 'idle' ? 'Primer bloque' : status === 'scheduled' ? 'Inicio programado' : status === 'schedule-invalidated' ? 'Programación desactualizada' : status === 'finished' ? 'Sesión finalizada' : snap.scheduleEnded ? 'Horario concluido' : snap.waiting ? 'Próximo inicio' : 'Bloque en curso');
        this.text('currentNumber', current ? `#${String(current.num).padStart(2,'0')}` : '');
        this.text('currentType', current?.type || 'Prepara el evento desde la Escaleta');
        const timerLabel = status === 'finished' ? 'Evento finalizado' : status === 'scheduled' ? 'Comienza en…' : status === 'schedule-invalidated' ? 'Revisa la pauta' : status === 'paused' ? 'Pausado · lectura congelada' :
            snap.scheduleEnded ? 'Horario concluido' : snap.waiting ? 'Comienza en…' : snap.isOvertime ? 'Tiempo de atraso' : status === 'idle' ? 'Duración prevista' : 'Tiempo restante';
        const timer = (snap.isOvertime ? '+' : '') + LiveEngine.formatDurationSeconds(Math.abs(snap.remainingSeconds));
        this.text('timerLabel', timerLabel); this.text('remainingTimer', timer);
        this.$('remainingTimer').dataset.alert = snap.alertLevel;
        this.text('elapsedTimer', LiveEngine.formatDurationSeconds(snap.elapsedSeconds));
        this.text('plannedTimer', current ? `${current.effectiveDuration} min` : '—');
        this.text('projectedEnd', snap.projectedEndMs ? LiveEngine.formatTimeSeconds(snap.projectedEndMs, snap.zone).slice(0,5) : '—');
        this.$('blockProgress').value = snap.progressPercent;
        this.text('nextTitle', snap.nextItem?.title || 'Cierre del evento');
        const previous = snap.currentItem ? snap.executable[snap.currentIndex - 1] : null;
        this.text('previousPanelNumber', previous ? `#${String(previous.num).padStart(2,'0')}` : '');
        this.text('previousPanelName', previous?.title || (snap.currentItem ? 'Inicio del evento' : 'Sin bloque anterior'));
        this.text('previousPanelMeta', previous ? `${previous.type || 'Bloque'} · ${previous.effectiveDuration} min` : (snap.currentItem ? 'Este es el primer bloque en seguimiento.' : 'El seguimiento todavía no ha comenzado.'));
        this.text('previousPanelTimeLabel', previous ? 'Inicio programado' : 'Estado');
        this.text('previousPanelTime', previous?.start || (snap.currentItem ? 'Primero' : '—'));
        const previousLink = this.$('previousPanelLink');
        previousLink.hidden = !previous;
        previousLink.onclick = event => {
            event.preventDefault(); if (!previous) return;
            this.follow = false; this.$('followLive').checked = false; this.selection = previous.key; this.render();
            this.$('contextTitle').scrollIntoView({ behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'start' });
        };
        const next = snap.nextItem;
        this.text('nextPanelNumber', next ? `#${String(next.num).padStart(2,'0')}` : '');
        this.text('nextPanelName', next?.title || (snap.items.length ? (status === 'finished' ? 'Evento finalizado' : 'Último bloque · después finaliza el evento') : 'No hay bloques disponibles'));
        this.text('nextPanelMeta', next ? `${next.type || 'Bloque'} · ${next.effectiveDuration} min` : (status === 'idle' ? 'El seguimiento todavía no ha comenzado.' : 'No hay un bloque posterior disponible.'));
        this.text('nextPanelTimeLabel', next ? (snap.trackingMode === 'manual' ? 'Inicio estimado' : 'Inicio programado') : 'Estado');
        const nextStart = next && snap.trackingMode === 'manual' && status !== 'idle' && status !== 'finished'
            ? LiveEngine.formatTimeSeconds(this.now() + Math.max(0, snap.remainingSeconds) * 1000, snap.zone).slice(0,5)
            : next?.start;
        this.text('nextPanelTime', nextStart || (status === 'finished' ? 'Finalizado' : '—'));
        const nextLink = this.$('nextPanelLink');
        nextLink.hidden = !next;
        nextLink.onclick = event => {
            event.preventDefault(); if (!next) return;
            this.follow = false; this.$('followLive').checked = false; this.selection = next.key; this.render();
            this.$('contextTitle').scrollIntoView({ behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'start' });
        };
        const stageStatus = this.$('stageStatus');
        if (stageStatus) {
            const label = stageStatus.querySelector('span');
            if (label) label.textContent = labels[status]; else stageStatus.textContent = labels[status];
            stageStatus.dataset.active = String(status === 'live' && !snap.waiting && !snap.scheduleEnded && this.connected);
        }
        this.text('stageTitle', current?.title || 'Sin bloques');
        this.text('stageTimerLabel', timerLabel); this.text('stageTimer', timer); this.$('stageTimer').dataset.alert = snap.alertLevel;
        this.text('stagePrevious', previous?.title || (snap.currentItem ? 'Inicio del evento' : '—'));
        this.text('stageNext', snap.nextItem?.title || (this.state.status === 'finished' ? 'Evento finalizado' : 'Cierre del evento'));
        this.renderCamarines(snap, current, timer, timerLabel, labels);
        if (this.follow || !snap.items.some(row => row.key === this.selection)) this.selection = current?.key || snap.items[0]?.key;
        this.text('blockCount', `${snap.items.length} bloques · ${snap.executable.length} en seguimiento`);
        this.$('emptyRundown').hidden = snap.items.length > 0;
        for (const row of snap.items) {
            const entry = this.rows.get(row.key) || this.createRow(row), selected = row.key === this.selection;
            entry.element.dataset.state = row.rowState; entry.element.dataset.selected = String(selected);
            const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };
            put(entry.num, String(row.num).padStart(2,'0')); put(entry.time, row.start); put(entry.title, row.title);
            put(entry.meta, `${row.type} · ${row.effectiveDuration} min`);
            put(entry.status, { active:this.state.status === 'paused' ? 'Pausado' : 'En curso', completed:snap.trackingMode === 'manual' ? 'Completado' : 'Horario pasado', future:'Pendiente', muted:'Excluido' }[row.rowState]);
            entry.button.setAttribute('aria-expanded', String(selected));
            if (row === current && this.state.status === 'live' && !snap.waiting && !snap.scheduleEnded) entry.button.setAttribute('aria-current', 'step');
            else entry.button.removeAttribute('aria-current');
            entry.extra.hidden = !selected;
            put(entry.end, `Término previsto: ${row.end}`);
            const future = this.state.status === 'idle' || (snap.trackingMode === 'schedule' ? row.startMs > this.now() : row.num > (current?.num || 0));
            entry.action.hidden = !this.operator || this.state.status === 'finished' || !(row.rowState === 'future' || row.isMuted && future);
            put(entry.action, row.isMuted ? 'Restaurar bloque' : 'Excluir del seguimiento'); entry.action.disabled = blocked;
        }
        for (const [key, entry] of this.rows) if (!snap.items.some(row => row.key === key)) { entry.element.remove(); this.rows.delete(key); }
        const selected = snap.items.find(row => row.key === this.selection);
        const script = String(selected?.raw.animator_script || selected?.raw.animatorScript || ''), notes = String(selected?.raw.notes || '');
        this.text('selectionHint', this.follow ? 'Consultando el bloque actual' : 'Consulta independiente · seguimiento desactivado');
        this.text('contextTitle', selected?.title || 'Guion y notas');
        this.text('scriptIndicator', script.trim() ? '•' : ''); this.text('notesIndicator', notes.trim() ? '•' : '');
        this.text('scriptCopy', script.trim() ? script : 'Este bloque no tiene guion. Puedes agregarlo desde la Escaleta.');
        this.text('notesCopy', notes.trim() ? notes : 'Este bloque no tiene notas operativas.');
    }
    openReport() {
        this.$('moreMenu').open = false;
        const container = this.$('reportRows'); container.replaceChildren();
        for (const row of this.snapshot?.items || []) {
            const article = document.createElement('article'); article.className = 'report-row';
            const title = document.createElement('strong'); title.textContent = `#${row.num} ${row.title}`;
            const planned = document.createElement('p'); planned.textContent = `Previsto: ${row.start} · ${row.duration} min`;
            article.append(title, planned);
            const records = this.state.history.filter(h => h.key ? h.key === row.key : h.num === row.num);
            if (!records.length) { const p = document.createElement('p'); p.textContent = 'Sin registro de ejecución real.'; article.append(p); }
            for (const h of records) {
                const p = document.createElement('p'); p.textContent = `Registro ${h.source || 'histórico'}: ${Number(h.actualDurationMinutes || 0).toFixed(1)} min · diferencia ${Number(h.diffMinutes || 0).toFixed(1)} min`;
                article.append(p);
            }
            container.append(article);
        }
        if (!this.$('reportDialog').open) this.$('reportDialog').showModal();
    }
}
document.addEventListener('DOMContentLoaded', () => { window.liveApp = new LiveApp(); });
