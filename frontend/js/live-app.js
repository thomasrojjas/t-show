/* Production console: persistent DOM, local reading state, server-confirmed actions. */
class LiveApp {
    constructor() {
        this.projectId = new URLSearchParams(location.search).get('project');
        this.state = LiveEngine.defaults(); this.version = 0; this.rows = new Map();
        this.connected = false; this.busy = false; this.follow = true; this.tab = 'script'; this.offset = 0;
        this.permission = 'viewer'; this.selection = null; this.readingKey = ''; this.syncing = null;
        this.bind();
        this.init().catch(error => this.message(error.message, true, true));
    }
    $(id) { return document.getElementById(id); }
    text(id, value) { const node = this.$(id); if (node.textContent !== String(value)) node.textContent = value; }
    now() { return Date.now() + this.offset; }
    get operator() { return ['owner', 'admin', 'editor'].includes(this.permission); }
    get manager() { return ['owner', 'admin'].includes(this.permission); }
    async init() {
        if (!this.projectId) { location.replace('/projects'); return; }
        this.$('backLink').href = `/schedule?project=${encodeURIComponent(this.projectId)}`;
        if (!await Auth.requireSession()) return;
        this.project = await ApiClient.getProject(this.projectId);
        const liveThemes = { nocturne:'#a8c7fa', violet:'#c084fc', cobalt:'#38bdf8', ember:'#ffb340', emerald:'#39ff88', monochrome:'#f2f4f7' };
        const visualTheme = liveThemes[this.project.visualTheme] ? this.project.visualTheme : 'nocturne';
        document.body.dataset.visualTheme = visualTheme;
        document.documentElement.style.setProperty('--accent', liveThemes[visualTheme]);
        this.permission = this.project.permission || 'viewer';
        this.text('eventName', this.project.eventName || 'Evento');
        document.title = `T-Show · ${this.project.eventName || 'En vivo'}`;
        this.text('roleLabel', { owner:'Propietario', admin:'Administrador', editor:'Director', viewer:'Solo lectura' }[this.permission] || 'Solo lectura');
        this.text('zoneLabel', LiveEngine.zone(this.project));
        try {
            const size = localStorage.getItem('tshow_live_text_size');
            if (['18', '22', '26'].includes(size)) { this.$('textSize').value = size; this.setTextSize(); }
        } catch (_) { /* Preferences are optional. */ }
        await this.refresh();
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
        this.$('connectionStatus').dataset.state = status;
        if (this.project) this.render();
    }
    accept(result) {
        if ((result.version || 0) < this.version) return;
        this.state = LiveEngine.defaults(result.data || {}); this.version = result.version || 0;
        if (result.serverNow) this.offset = Date.parse(result.serverNow) - Date.now();
        this.render();
    }
    async refresh() {
        if (!this.project || this.syncing || this.busy) return;
        this.syncing = (async () => {
            try {
                this.accept(await LiveSync.fetchLiveState(this.projectId));
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
        if (prompt && !await this.confirm(prompt[0], prompt[1])) return;
        if (this.busy || !this.connected) return;
        this.busy = true; this.render(); this.message('Guardando cambio…');
        try {
            const result = await LiveSync.pushLiveState(this.projectId, command, this.version);
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
        this.$('nextButton').onclick = () => this.execute({ action:'next' });
        this.$('extendButton').onclick = () => this.execute({ action:'extend', minutes:Number(this.$('extendMinutes').value) });
        this.$('restartBlock').onclick = () => this.execute({ action:'restart-block' }, ['Reiniciar tiempo del bloque', 'Se registrará el tramo actual y el cronómetro volverá a la duración completa del bloque.']);
        this.$('finishButton').onclick = () => this.execute({ action:'finish' }, ['Finalizar evento', 'La sesión quedará finalizada y conservará los tiempos registrados.']);
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
        this.$('stageButton').onclick = () => { this.$('stageDialog').showModal(); this.render(); };
        this.$('closeStage').onclick = () => this.$('stageDialog').close();
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
        document.addEventListener('click', event => { if (!this.$('moreMenu').contains(event.target)) this.$('moreMenu').open = false; });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') this.$('moreMenu').open = false;
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
    render() {
        if (!this.project) return;
        let snap;
        try { snap = LiveEngine.computeLiveSnapshot(this.project, this.state, this.now()); }
        catch (error) { this.message(error.message, true); return; }
        this.snapshot = snap;
        const blocked = !this.connected || this.busy;
        const labels = { idle:'En espera', live:snap.scheduleEnded ? 'Horario concluido' : 'En vivo', paused:'Pausado', finished:'Finalizado' };
        this.text('sessionStatus', labels[this.state.status]); this.$('sessionStatus').dataset.state = this.state.status;
        this.text('masterClock', LiveEngine.formatTimeSeconds(this.now(), snap.zone));
        this.$('trackingMode').value = this.state.trackingMode; this.$('trackingMode').disabled = blocked || !this.operator || this.state.status === 'finished';
        this.text('modeHelp', snap.trackingMode === 'schedule' ? 'El horario original continúa durante la pausa.' : 'Al agotarse el tiempo, el bloque continúa hasta avanzar manualmente.');
        const primary = this.$('primaryAction');
        primary.hidden = !this.operator && this.state.status !== 'finished';
        primary.disabled = this.state.status !== 'finished' && (blocked || !snap.executable.length);
        primary.setAttribute('aria-busy', String(this.busy));
        this.text('primaryAction', this.busy ? 'Guardando…' : { idle:'▶ Iniciar seguimiento', live:'Ⅱ Pausar seguimiento', paused:snap.trackingMode === 'schedule' ? '▶ Reanudar según horario' : '▶ Reanudar', finished:'Ver balance' }[this.state.status]);
        this.$('manualControls').hidden = !this.operator || snap.trackingMode !== 'manual' || this.state.status !== 'live';
        for (const id of ['nextButton','extendButton','restartBlock','extendMinutes']) this.$(id).disabled = blocked || !snap.currentItem;
        this.$('finishButton').hidden = !this.manager || !['live','paused'].includes(this.state.status);
        this.$('resetButton').hidden = !this.manager || this.state.status === 'live';
        this.$('finishButton').disabled = blocked; this.$('resetButton').disabled = blocked;
        const current = snap.currentItem;
        this.text('currentTitle', current?.title || 'Aún no hay bloques');
        this.text('currentContext', this.state.status === 'idle' ? 'Primer bloque' : this.state.status === 'finished' ? 'Sesión finalizada' : snap.scheduleEnded ? 'Horario concluido' : snap.waiting ? 'Próximo inicio' : 'Bloque en curso');
        this.text('currentNumber', current ? `#${String(current.num).padStart(2,'0')}` : '');
        this.text('currentType', current?.type || 'Prepara el evento desde la Escaleta');
        const timerLabel = this.state.status === 'finished' ? 'Evento finalizado' : this.state.status === 'paused' ? 'Pausado · lectura congelada' :
            snap.scheduleEnded ? 'Horario concluido' : snap.waiting ? 'Comienza en…' : snap.isOvertime ? 'Tiempo de atraso' : this.state.status === 'idle' ? 'Duración prevista' : 'Tiempo restante';
        const timer = (snap.isOvertime ? '+' : '') + LiveEngine.formatDurationSeconds(Math.abs(snap.remainingSeconds));
        this.text('timerLabel', timerLabel); this.text('remainingTimer', timer);
        this.$('remainingTimer').dataset.alert = snap.alertLevel;
        this.text('elapsedTimer', LiveEngine.formatDurationSeconds(snap.elapsedSeconds));
        this.text('plannedTimer', current ? `${current.effectiveDuration} min` : '—');
        this.text('projectedEnd', snap.projectedEndMs ? LiveEngine.formatTimeSeconds(snap.projectedEndMs, snap.zone).slice(0,5) : '—');
        this.$('blockProgress').value = snap.progressPercent;
        this.text('nextTitle', snap.nextItem?.title || 'Cierre del evento');
        this.text('stageStatus', labels[this.state.status]); this.text('stageTitle', current?.title || 'Sin bloques');
        this.text('stageTimerLabel', timerLabel); this.text('stageTimer', timer); this.$('stageTimer').dataset.alert = snap.alertLevel;
        this.text('stageNext', snap.nextItem?.title || 'Cierre del evento');
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
