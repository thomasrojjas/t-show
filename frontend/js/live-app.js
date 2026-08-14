/**
 * LiveApp
 * Main UI and execution controller for Live Stage & Viewer Platform
 */

class LiveApp {
    constructor() {
        this.projectData = null;
        this.projectName = '';
        this.role = 'viewer'; // 'viewer' | 'director'
        this.directorPIN = '1234';
        this.liveState = {
            status: 'idle', // 'idle' | 'live' | 'paused' | 'finished'
            currentIndex: 0,
            currentBlockStartTime: null,
            omittedItemNums: [],
            history: []
        };
        this.tickerInterval = null;

        this.init();
    }

    async init() {
        // Extract project name from URL or use first available
        const urlParams = new URLSearchParams(window.location.search);
        this.projectName = urlParams.get('project') || '';

        // Load project from API / LocalStorage
        await this.loadProject();

        // Check if director role requested
        if (urlParams.get('role') === 'director') {
            this.role = 'director';
        }

        // Start listening to live session
        await this.initLiveState();

        // Bind events
        this.bindEvents();

        // Start 1-second master ticker
        this.startTicker();

        // Update UI
        this.updateRoleUI();
        this.render();
    }

    async loadProject() {
        const all = await ApiClient.getAllProjects();
        const projects = all.data || {};

        if (this.projectName && projects[this.projectName]) {
            this.projectData = projects[this.projectName];
        } else {
            const names = Object.keys(projects);
            if (names.length > 0) {
                this.projectName = names[0];
                this.projectData = projects[this.projectName];
            } else {
                this.projectName = 'Gran Concierto & Show Estelar';
                this.projectData = {
                    eventName: this.projectName,
                    convocatoriaTime: '18:30',
                    convocatoriaDuration: 30,
                    doorsTime: '19:30',
                    doorsDuration: 60,
                    showStartMode: 'auto',
                    showStartTimeInput: '20:30',
                    blocks: [
                        { id: 'b1', type: 'ANIMACIÓN', title: 'Animadores: Bienvenida & Presentación Inicial', duration: 15, bis: 0 },
                        { id: 'b2', type: 'SHOW', title: 'Artista 1 - Show Principal', duration: 55, bis: 10 },
                        { id: 'b3', type: 'ANIMACIÓN', title: 'Animadores: Concursos / Intervención', duration: 15, bis: 0 },
                        { id: 'b4', type: 'SHOW', title: 'Artista 2 - Show Estelar', duration: 60, bis: 15 },
                        { id: 'b5', type: 'SHOW', title: 'Coronación', duration: 30, bis: 0 },
                        { id: 'b6', type: 'ANIMACIÓN', title: 'Animadores: Intervención / Sorteo', duration: 10, bis: 0 },
                        { id: 'b7', type: 'SHOW', title: 'Artista 4 - Presentation', duration: 60, bis: 10 },
                        { id: 'b8', type: 'ANIMACIÓN', title: 'Animadores: Despedida & Cierre del Evento', duration: 10, bis: 0 }
                    ]
                };
            }
        }
    }

    async initLiveState() {
        // Start polling from server
        LiveSync.startLivePolling(this.projectName, (remoteState) => {
            if (remoteState) {
                this.liveState = remoteState;
                this.render();
            }
        });

        // Pull initial state
        const initial = await LiveSync.pullLiveState(this.projectName);
        if (initial) {
            this.liveState = initial;
        }
    }

    bindEvents() {
        // Master Clock
        setInterval(() => {
            const clockEl = document.getElementById('masterClock');
            if (clockEl) {
                clockEl.innerText = LiveEngine.formatTimeSeconds(new Date());
            }
        }, 1000);
    }

    startTicker() {
        if (this.tickerInterval) clearInterval(this.tickerInterval);
        this.tickerInterval = setInterval(() => {
            this.render();
        }, 1000);
    }

    updateRoleUI() {
        const directorBar = document.getElementById('directorToolbar');
        const roleBtn = document.getElementById('btnToggleRole');
        const shareLinkBtn = document.getElementById('btnShareViewer');

        if (this.role === 'director') {
            if (directorBar) directorBar.style.display = 'flex';
            if (roleBtn) roleBtn.innerHTML = '🔒 Salir de Modo Director';
        } else {
            if (directorBar) directorBar.style.display = 'none';
            if (roleBtn) roleBtn.innerHTML = '🔑 Acceso Director';
        }
    }

    toggleRoleModal() {
        if (this.role === 'director') {
            this.role = 'viewer';
            this.updateRoleUI();
            this.render();
            PrintExportManager.showToast('Modo Espectador activado (Solo Lectura)', 'info');
        } else {
            this.openModal('pinModal');
            setTimeout(() => {
                const pinInput = document.getElementById('pinInput');
                if (pinInput) {
                    pinInput.value = '';
                    pinInput.focus();
                }
            }, 100);
        }
    }

    verifyPIN() {
        const pinInput = document.getElementById('pinInput');
        const pinVal = pinInput ? pinInput.value.trim() : '';

        if (pinVal === this.directorPIN) {
            this.role = 'director';
            this.closeModal('pinModal');
            this.updateRoleUI();
            this.render();
            PrintExportManager.showToast('¡Modo Director desbloqueado!', 'success');
        } else {
            alert('PIN incorrecto. Intenta con 1234');
            if (pinInput) pinInput.focus();
        }
    }

    openModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('active');
    }

    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('active');
    }

    // --- PLAY / PAUSE & TRACKING CONTROLS ---

    async togglePlayPause() {
        if (this.liveState.status === 'live') {
            this.liveState.status = 'paused';
            await this.syncAndRender('⏸ Seguimiento en Vivo Pausado');
        } else {
            this.liveState.status = 'live';
            if (!this.liveState.currentBlockStartTime) {
                this.liveState.currentBlockStartTime = new Date().toISOString();
            }
            const modeName = this.liveState.trackingMode === 'manual' ? 'Conducción Manual' : 'Seguimiento por Horario';
            await this.syncAndRender(`▶ ¡Play en Vivo Activado! (${modeName})`);
        }
    }

    async setTrackingMode(mode) {
        if (this.role !== 'director') {
            // Viewers can also toggle local viewing mode if preferred
            this.liveState.trackingMode = mode;
            this.render();
            return;
        }
        this.liveState.trackingMode = mode;
        if (mode === 'manual' && !this.liveState.currentBlockStartTime) {
            this.liveState.currentBlockStartTime = new Date().toISOString();
        }
        await this.syncAndRender(`Modo de seguimiento: ${mode === 'schedule' ? '🕒 Según Horario Programado' : '⚡ Conducción Manual'}`);
    }

    // --- DIRECTOR ACTIONS ---

    async startShow() {
        this.liveState.status = 'live';
        this.liveState.currentIndex = 0;
        this.liveState.currentBlockStartTime = new Date().toISOString();
        this.liveState.history = [];
        await this.syncAndRender('▶ ¡Evento Iniciado en Vivo!');
    }

    async tapNextBlock() {
        if (this.role !== 'director' || this.liveState.status !== 'live') return;

        const snapshot = LiveEngine.computeLiveSnapshot(this.projectData, this.liveState);
        const currentItem = snapshot.currentItem;
        const now = new Date();

        if (currentItem) {
            // Record history
            const startMs = this.liveState.currentBlockStartTime ? new Date(this.liveState.currentBlockStartTime).getTime() : now.getTime();
            const actualDurationMinutes = Math.round((now.getTime() - startMs) / 60000);

            this.liveState.history.push({
                num: currentItem.num,
                type: currentItem.type,
                title: currentItem.title,
                plannedStart: currentItem.start,
                plannedDuration: currentItem.duration,
                plannedEnd: currentItem.end,
                actualStart: new Date(startMs).toISOString(),
                actualStartFormatted: LiveEngine.formatTimeSeconds(new Date(startMs)),
                actualEnd: now.toISOString(),
                actualEndFormatted: LiveEngine.formatTimeSeconds(now),
                actualDurationMinutes: actualDurationMinutes,
                diffMinutes: actualDurationMinutes - currentItem.duration
            });
        }

        // Advance to next active item
        this.liveState.currentIndex += 1;
        this.liveState.currentBlockStartTime = now.toISOString();

        // Check if show finished
        if (this.liveState.currentIndex >= snapshot.items.length) {
            this.liveState.status = 'finished';
            await this.syncAndRender('🏁 ¡Evento Concluido!');
            this.openReportModal();
            return;
        }

        await this.syncAndRender(`⚡ TAP ejecutado: Cambio a bloque #${this.liveState.currentIndex + 1}`);
    }

    async omitBlock(itemNum, title) {
        if (this.role !== 'director') return;
        if (confirm(`¿Omitir o eliminar en vivo el bloque "${title}"?`)) {
            if (!this.liveState.omittedItemNums) this.liveState.omittedItemNums = [];
            this.liveState.omittedItemNums.push(itemNum);
            await this.syncAndRender(`Bloque "${title}" omitido. Escaleta recalculada.`);
        }
    }

    async resyncNow() {
        if (this.role !== 'director' || this.liveState.status !== 'live') return;
        this.liveState.currentBlockStartTime = new Date().toISOString();
        await this.syncAndRender('⏱ Horario reajustado a partir del momento actual');
    }

    async finishShow() {
        if (this.role !== 'director') return;
        if (confirm('¿Finalizar oficialmente la ejecución del show en vivo?')) {
            this.liveState.status = 'finished';
            await this.syncAndRender('Evento finalizado');
            this.openReportModal();
        }
    }

    async resetLiveSession() {
        if (this.role !== 'director') return;
        if (confirm('¿Restablecer la sesión en vivo al estado inicial de espera?')) {
            this.liveState = {
                status: 'idle',
                currentIndex: 0,
                currentBlockStartTime: null,
                omittedItemNums: [],
                history: []
            };
            await this.syncAndRender('Sesión en vivo restablecida');
        }
    }

    async syncAndRender(message = null) {
        await LiveSync.pushLiveState(this.projectName, this.liveState);
        this.render();
        if (message) PrintExportManager.showToast(message, 'info');
    }

    // --- RENDERING ---

    render() {
        const snapshot = LiveEngine.computeLiveSnapshot(this.projectData, this.liveState);
        if (!snapshot) return;

        // 1. Update Title & Status Badge
        const titleEl = document.getElementById('liveProjectTitle');
        if (titleEl) titleEl.innerText = this.projectName;

        const isLive = snapshot.status === 'live';
        const isSchedule = (this.liveState.trackingMode || 'schedule') === 'schedule';

        const statusBadge = document.getElementById('liveStatusBadge');
        if (statusBadge) {
            statusBadge.className = `live-badge-status status-${snapshot.status}`;
            if (snapshot.status === 'idle') statusBadge.innerText = '⏸ EN ESPERA';
            if (snapshot.status === 'live') statusBadge.innerText = isSchedule ? '🔴 EN VIVO (HORARIO)' : '🔴 EN VIVO (MANUAL)';
            if (snapshot.status === 'paused') statusBadge.innerText = '⏸ EN PAUSA';
            if (snapshot.status === 'finished') statusBadge.innerText = '🏁 FINALIZADO';
        }

        // 1.1 Update Play / Pause Buttons in Header and Director Toolbar
        const btnHeaderPlay = document.getElementById('btnHeaderPlay');
        const btnHeaderPlayIcon = document.getElementById('btnHeaderPlayIcon');
        const btnHeaderPlayText = document.getElementById('btnHeaderPlayText');

        if (btnHeaderPlay && btnHeaderPlayIcon && btnHeaderPlayText) {
            if (isLive) {
                btnHeaderPlay.classList.add('is-playing');
                btnHeaderPlayIcon.innerText = '⏸';
                btnHeaderPlayText.innerText = 'PAUSAR';
            } else {
                btnHeaderPlay.classList.remove('is-playing');
                btnHeaderPlayIcon.innerText = '▶';
                btnHeaderPlayText.innerText = isSchedule ? 'PLAY / SEGUIR HORARIO' : 'PLAY (INICIAR)';
            }
        }

        const btnDirectorPlay = document.getElementById('btnDirectorPlay');
        const btnDirectorPlayIcon = document.getElementById('btnDirectorPlayIcon');
        const btnDirectorPlayText = document.getElementById('btnDirectorPlayText');

        if (btnDirectorPlay && btnDirectorPlayIcon && btnDirectorPlayText) {
            if (isLive) {
                btnDirectorPlay.classList.add('is-playing');
                btnDirectorPlayIcon.innerText = '⏸';
                btnDirectorPlayText.innerText = 'Pausar Show';
            } else {
                btnDirectorPlay.classList.remove('is-playing');
                btnDirectorPlayIcon.innerText = '▶';
                btnDirectorPlayText.innerText = isSchedule ? '▶ Play Horario' : '▶ Play Manual';
            }
        }

        // Mode switch buttons
        const btnModeSchedule = document.getElementById('btnModeSchedule');
        const btnModeManual = document.getElementById('btnModeManual');
        if (btnModeSchedule && btnModeManual) {
            btnModeSchedule.classList.toggle('active', isSchedule);
            btnModeManual.classList.toggle('active', !isSchedule);
        }

        // 2. Full-Screen Ambient Perimeter Border Alert
        const borderEl = document.getElementById('screenAmbientBorder');
        if (borderEl) {
            borderEl.className = '';
            if (snapshot.alertLevel === 'yellow') borderEl.classList.add('screen-alert-yellow');
            if (snapshot.alertLevel === 'red') borderEl.classList.add('screen-alert-red');
            if (snapshot.alertLevel === 'overtime') borderEl.classList.add('screen-alert-overtime');
        }

        // 3. Hero Card
        const heroBlockName = document.getElementById('heroBlockName');
        const heroTypeBadge = document.getElementById('heroTypeBadge');
        const heroRemainingTimer = document.getElementById('heroRemainingTimer');
        const heroElapsedTimer = document.getElementById('heroElapsedTimer');
        const heroPlannedTimer = document.getElementById('heroPlannedTimer');
        const heroProgressFill = document.getElementById('heroProgressFill');
        const heroProjectedEnd = document.getElementById('heroProjectedEnd');

        if (snapshot.currentItem && snapshot.status === 'live') {
            if (heroBlockName) heroBlockName.innerText = snapshot.currentItem.title;
            if (heroTypeBadge) {
                heroTypeBadge.innerText = snapshot.currentItem.type;
                heroTypeBadge.className = `hero-type-badge ${snapshot.currentItem.badgeClass}`;
            }

            if (heroRemainingTimer) {
                if (snapshot.isOvertime) {
                    heroRemainingTimer.innerText = `+${LiveEngine.formatDurationSeconds(snapshot.overtimeSeconds)}`;
                    heroRemainingTimer.style.color = '#ef4444';
                } else {
                    heroRemainingTimer.innerText = LiveEngine.formatDurationSeconds(snapshot.remainingSeconds);
                    heroRemainingTimer.style.color = snapshot.alertLevel === 'red' ? '#ef4444' : (snapshot.alertLevel === 'yellow' ? '#f59e0b' : '#34d399');
                }
            }

            if (heroElapsedTimer) {
                heroElapsedTimer.innerText = LiveEngine.formatDurationSeconds(snapshot.elapsedSeconds);
            }

            if (heroPlannedTimer) {
                heroPlannedTimer.innerText = `${snapshot.currentItem.duration} min`;
            }

            if (heroProjectedEnd) {
                heroProjectedEnd.innerText = snapshot.projectedEndTime;
            }

            if (heroProgressFill) {
                heroProgressFill.style.width = `${snapshot.progressPercent}%`;
                heroProgressFill.className = 'hero-progress-fill';
                if (snapshot.alertLevel === 'overtime') heroProgressFill.classList.add('fill-overtime');
                else if (snapshot.alertLevel === 'red') heroProgressFill.classList.add('fill-red');
                else if (snapshot.alertLevel === 'yellow') heroProgressFill.classList.add('fill-yellow');
            }
        } else if (snapshot.status === 'finished') {
            if (heroBlockName) heroBlockName.innerText = '🏁 Evento Finalizado con Éxito';
            if (heroRemainingTimer) { heroRemainingTimer.innerText = '00:00'; heroRemainingTimer.style.color = '#10b981'; }
            if (heroProgressFill) heroProgressFill.style.width = '100%';
        } else if (snapshot.status === 'paused' && snapshot.currentItem) {
            if (heroBlockName) heroBlockName.innerText = `⏸ ${snapshot.currentItem.title} (En Pausa)`;
            if (heroTypeBadge) {
                heroTypeBadge.innerText = snapshot.currentItem.type;
                heroTypeBadge.className = `hero-type-badge ${snapshot.currentItem.badgeClass}`;
            }
            if (heroRemainingTimer) {
                heroRemainingTimer.innerText = LiveEngine.formatDurationSeconds(snapshot.remainingSeconds);
                heroRemainingTimer.style.color = '#f59e0b';
            }
            if (heroElapsedTimer) {
                heroElapsedTimer.innerText = LiveEngine.formatDurationSeconds(snapshot.elapsedSeconds);
            }
            if (heroPlannedTimer) {
                heroPlannedTimer.innerText = `${snapshot.currentItem.duration} min`;
            }
            if (heroProjectedEnd) {
                heroProjectedEnd.innerText = snapshot.projectedEndTime;
            }
            if (heroProgressFill) {
                heroProgressFill.style.width = `${snapshot.progressPercent}%`;
                heroProgressFill.className = 'hero-progress-fill fill-yellow';
            }
        } else {
            const firstItem = snapshot.currentItem || (snapshot.items && snapshot.items[0]);
            if (heroBlockName) heroBlockName.innerText = firstItem ? `Listo: ${firstItem.title}` : 'Listo para Iniciar Pauta en Vivo';
            if (heroTypeBadge && firstItem) {
                heroTypeBadge.innerText = firstItem.type;
                heroTypeBadge.className = `hero-type-badge ${firstItem.badgeClass}`;
            }
            if (heroRemainingTimer) { heroRemainingTimer.innerText = firstItem ? `${firstItem.duration}:00` : '--:--'; heroRemainingTimer.style.color = '#38bdf8'; }
            if (heroElapsedTimer) { heroElapsedTimer.innerText = '00:00'; }
            if (heroPlannedTimer && firstItem) { heroPlannedTimer.innerText = `${firstItem.duration} min`; }
            if (heroProjectedEnd) { heroProjectedEnd.innerText = snapshot.projectedEndTime || '--:--'; }
            if (heroProgressFill) heroProgressFill.style.width = '0%';
        }

        // 4. Render Table Rows
        const tbody = document.getElementById('liveTableBody');
        if (tbody) {
            tbody.innerHTML = '';
            snapshot.items.forEach((r, idx) => {
                const tr = document.createElement('tr');
                tr.className = `row-${r.rowState}`;

                let progressHtml = '';
                if (r.rowState === 'active') {
                    let fillClass = '';
                    if (snapshot.alertLevel === 'yellow') fillClass = 'fill-yellow';
                    if (snapshot.alertLevel === 'red' || snapshot.alertLevel === 'overtime') fillClass = 'fill-red';
                    progressHtml = `<div class="row-progress-fill ${fillClass}" style="width: ${snapshot.progressPercent}%"></div>`;
                }

                let actionsHtml = '';
                if (this.role === 'director') {
                    if (r.rowState === 'future') {
                        actionsHtml = `<button class="btn-omit-block" onclick="liveApp.omitBlock(${r.num}, '${r.title.replace(/'/g, "\\'")}')" title="Omitir o eliminar este bloque en vivo">✕ Omitir</button>`;
                    } else if (r.rowState === 'active') {
                        actionsHtml = `<span style="color: #38bdf8; font-weight: 800; font-size: 11px;">🔴 EN CURSO</span>`;
                    } else {
                        actionsHtml = `<span style="color: #10b981; font-weight: 800; font-size: 11px;">✔ HECHO</span>`;
                    }
                }

                tr.innerHTML = `
                    <td style="text-align: center; font-weight: bold; width: 40px; position: relative; z-index: 1;">
                        ${progressHtml}
                        ${r.num}
                    </td>
                    <td style="position: relative; z-index: 1;"><span class="badge ${r.badgeClass}">${r.type}</span></td>
                    <td style="font-weight: 700; position: relative; z-index: 1;">${r.title}</td>
                    <td class="time-cell" style="position: relative; z-index: 1;">${r.liveStart}</td>
                    <td style="font-weight: 700; position: relative; z-index: 1;">${r.duration} min</td>
                    <td class="time-cell" style="position: relative; z-index: 1;">${r.liveEnd}</td>
                    ${this.role === 'director' ? `<td style="text-align: right; position: relative; z-index: 1;">${actionsHtml}</td>` : ''}
                `;
                tbody.appendChild(tr);
            });
        }
    }

    // --- REPORT POST-SHOW ---

    openReportModal() {
        const tbody = document.getElementById('reportBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const history = this.liveState.history || [];
        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 15px; color: #9ca3af;">No hay datos registrados aún.</td></tr>';
            this.openModal('reportModal');
            return;
        }

        let totalDiffMin = 0;

        history.forEach(h => {
            const tr = document.createElement('tr');
            totalDiffMin += h.diffMinutes;

            let diffClass = 'diff-ontime';
            let diffSign = '';
            if (h.diffMinutes > 0) { diffClass = 'diff-late'; diffSign = '+'; }
            if (h.diffMinutes < 0) { diffClass = 'diff-early'; }

            tr.innerHTML = `
                <td style="font-weight: bold;">#${h.num}</td>
                <td><span class="badge badge-show">${h.type}</span></td>
                <td style="font-weight: 600;">${h.title}</td>
                <td>${h.plannedStart} / <strong>${h.actualStartFormatted}</strong></td>
                <td>${h.plannedDuration} min / <strong>${h.actualDurationMinutes} min</strong></td>
                <td class="${diffClass}">${diffSign}${h.diffMinutes} min</td>
            `;
            tbody.appendChild(tr);
        });

        const totalDiffEl = document.getElementById('reportTotalDiff');
        if (totalDiffEl) {
            totalDiffEl.innerText = `${totalDiffMin > 0 ? '+' : ''}${totalDiffMin} min`;
            totalDiffEl.className = totalDiffMin > 0 ? 'diff-late' : 'diff-ontime';
        }

        this.openModal('reportModal');
    }

    copyShareLink() {
        const url = window.location.origin + window.location.pathname + `?project=${encodeURIComponent(this.projectName)}`;
        navigator.clipboard.writeText(url).then(() => {
            PrintExportManager.showToast('Enlace de Espectador copiado al portapapeles', 'success');
        });
    }
}

// Global instance
let liveApp;
document.addEventListener('DOMContentLoaded', () => {
    liveApp = new LiveApp();
    window.liveApp = liveApp;
});
