/**
 * LiveApp
 * Main UI and execution controller for Live Stage, Director & Administrator Platform
 */

class LiveApp {
    constructor() {
        this.projectData = null;
        this.projectName = '';
        this.role = 'viewer'; // 'viewer' | 'director' | 'admin'
        this.targetModalRole = 'admin'; // 'admin' | 'director'
        
        this.directorPIN = '1234';
        this.adminPIN = '9999';

        this.liveState = {
            status: 'idle', // 'idle' | 'live' | 'paused' | 'finished'
            trackingMode: 'schedule', // 'schedule' | 'manual'
            currentIndex: 0,
            currentBlockStartTime: null,
            omittedItemNums: [],
            mutedBlockNums: [],
            history: []
        };

        this.tickerInterval = null;

        // Start clock immediately so top master clock ALWAYS ticks
        this.startMasterClock();
        this.startTicker();

        // Initialize asynchronous data
        this.init();
    }

    startMasterClock() {
        const updateClock = () => {
            const clockEl = document.getElementById('masterClock');
            if (clockEl) {
                clockEl.innerText = LiveEngine.formatTimeSeconds(new Date());
            }
        };
        updateClock();
        setInterval(updateClock, 1000);
    }

    startTicker() {
        if (this.tickerInterval) clearInterval(this.tickerInterval);
        this.tickerInterval = setInterval(() => {
            this.render();
        }, 1000);
    }

    async init() {
        const urlParams = new URLSearchParams(window.location.search);
        this.projectName = urlParams.get('project') || '';

        const roleParam = urlParams.get('role');
        if (roleParam === 'admin') {
            this.role = 'admin';
        } else if (roleParam === 'director') {
            this.role = 'director';
        }

        // Load project from API / LocalStorage
        await this.loadProject();

        // Load initial live state & start listener
        await this.initLiveState();

        // Update UI
        this.updateRoleUI();
        this.render();
    }

    async loadProject() {
        try {
            const all = await ApiClient.getAllProjects();
            const projects = (all && all.data) ? all.data : {};

            if (this.projectName && projects[this.projectName]) {
                this.projectData = projects[this.projectName];
            } else {
                const names = Object.keys(projects);
                if (names.length > 0) {
                    this.projectName = names[0];
                    this.projectData = projects[this.projectName];
                }
            }
        } catch (e) {
            console.error('Error loading project data:', e);
        }
    }

    async initLiveState() {
        try {
            // Pull initial state
            const initial = await LiveSync.fetchLiveState(this.projectName);
            if (initial) {
                this.liveState = { ...this.liveState, ...initial };
            }

            // Start polling from server
            LiveSync.startListening(this.projectName, (remoteState) => {
                if (remoteState) {
                    this.liveState = remoteState;
                    this.render();
                }
            });
        } catch (e) {
            console.error('Error initializing live sync:', e);
        }
    }

    updateRoleUI() {
        const adminBar = document.getElementById('adminToolbar');
        const directorBar = document.getElementById('directorToolbar');
        const roleBadge = document.getElementById('currentRoleBadge');

        if (adminBar) adminBar.style.display = (this.role === 'admin') ? 'flex' : 'none';
        if (directorBar) directorBar.style.display = (this.role === 'director') ? 'flex' : 'none';

        if (roleBadge) {
            roleBadge.className = `role-badge role-${this.role}`;
            if (this.role === 'admin') roleBadge.innerText = '👑 ADMINISTRADOR';
            else if (this.role === 'director') roleBadge.innerText = '🎬 DIRECTOR';
            else roleBadge.innerText = '👁 ESPECTADOR';
        }
    }

    toggleRoleModal() {
        this.setModalTargetRole(this.role === 'admin' ? 'admin' : 'director');
        this.openModal('pinModal');
        setTimeout(() => {
            const pinInput = document.getElementById('pinInput');
            if (pinInput) {
                pinInput.value = '';
                pinInput.focus();
            }
        }, 100);
    }

    setModalTargetRole(targetRole) {
        this.targetModalRole = targetRole;
        const btnAdmin = document.getElementById('btnSelectRoleAdmin');
        const btnDirector = document.getElementById('btnSelectRoleDirector');
        const hintText = document.getElementById('roleHintText');

        if (btnAdmin && btnDirector) {
            if (targetRole === 'admin') {
                btnAdmin.classList.add('btn-primary');
                btnAdmin.classList.remove('btn-secondary');
                btnDirector.classList.add('btn-secondary');
                btnDirector.classList.remove('btn-primary');
                if (hintText) hintText.innerHTML = '👑 <strong>Administrador:</strong> Control de Inicio, Detención y Silenciar Bloques (PIN: 9999)';
            } else {
                btnDirector.classList.add('btn-primary');
                btnDirector.classList.remove('btn-secondary');
                btnAdmin.classList.add('btn-secondary');
                btnAdmin.classList.remove('btn-primary');
                if (hintText) hintText.innerHTML = '🎬 <strong>Director:</strong> Conducción con Botón TAP y Reajuste en Vivo (PIN: 1234)';
            }
        }
    }

    setRoleAsViewer() {
        this.role = 'viewer';
        this.closeModal('pinModal');
        this.updateRoleUI();
        this.render();
        PrintExportManager.showToast('Modo Espectador activado (Solo Lectura)', 'info');
    }

    verifyPIN() {
        const pinInput = document.getElementById('pinInput');
        const pinVal = pinInput ? pinInput.value.trim() : '';

        if (this.targetModalRole === 'admin' && (pinVal === this.adminPIN || pinVal === 'admin')) {
            this.role = 'admin';
            this.closeModal('pinModal');
            this.updateRoleUI();
            this.render();
            PrintExportManager.showToast('¡Modo Administrador desbloqueado!', 'success');
        } else if (this.targetModalRole === 'director' && pinVal === this.directorPIN) {
            this.role = 'director';
            this.closeModal('pinModal');
            this.updateRoleUI();
            this.render();
            PrintExportManager.showToast('¡Modo Director de Escenario desbloqueado!', 'success');
        } else {
            alert(`PIN incorrecto para rol ${this.targetModalRole === 'admin' ? 'Administrador (9999)' : 'Director (1234)'}`);
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
        this.liveState.trackingMode = mode;
        if (mode === 'manual' && !this.liveState.currentBlockStartTime) {
            this.liveState.currentBlockStartTime = new Date().toISOString();
        }
        await this.syncAndRender(`Modo de seguimiento: ${mode === 'schedule' ? '🕒 Según Horario Programado' : '⚡ Conducción Manual'}`);
    }

    // --- ADMIN & DIRECTOR ACTIONS ---

    async startShow() {
        this.liveState.status = 'live';
        this.liveState.currentIndex = 0;
        this.liveState.currentBlockStartTime = new Date().toISOString();
        this.liveState.history = [];
        await this.syncAndRender('▶ ¡Evento Iniciado en Vivo!');
    }

    async stopShow() {
        if (this.role !== 'admin') {
            alert('Solo el Administrador puede detener oficialmente el show.');
            return;
        }
        if (confirm('¿Detener el programa/show en vivo? El cronómetro se pausará y los tiempos quedarán registrados.')) {
            this.liveState.status = 'paused';
            await this.syncAndRender('⏹ Show detenido por el Administrador');
        }
    }

    async muteBlock(itemNum, title) {
        if (this.role !== 'admin') {
            alert('Solo el Administrador puede silenciar o excluir bloques.');
            return;
        }
        if (confirm(`¿Silenciar y excluir el bloque "${title}"? Se ajustarán los horarios de todos los bloques siguientes automáticamente.`)) {
            if (!this.liveState.mutedBlockNums) this.liveState.mutedBlockNums = [];
            if (!this.liveState.mutedBlockNums.includes(itemNum)) {
                this.liveState.mutedBlockNums.push(itemNum);
            }
            await this.syncAndRender(`🔇 Bloque "${title}" silenciado. Tiempos recalculados.`);
        }
    }

    async unmuteBlock(itemNum, title) {
        if (this.role !== 'admin') {
            alert('Solo el Administrador puede reactivar bloques.');
            return;
        }
        if (!this.liveState.mutedBlockNums) this.liveState.mutedBlockNums = [];
        this.liveState.mutedBlockNums = this.liveState.mutedBlockNums.filter(n => n !== itemNum);
        await this.syncAndRender(`🔊 Bloque "${title}" reactivado. Tiempos recalculados.`);
    }

    async tapNextBlock() {
        if (this.role !== 'director' && this.role !== 'admin') return;
        if (this.liveState.status !== 'live') {
            this.liveState.status = 'live';
        }

        const snapshot = LiveEngine.computeLiveSnapshot(this.projectData, this.liveState);
        const currentItem = snapshot.currentItem;
        const now = new Date();

        if (currentItem) {
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

        this.liveState.currentIndex += 1;
        this.liveState.currentBlockStartTime = now.toISOString();

        if (this.liveState.currentIndex >= snapshot.items.filter(i => !i.isMuted).length) {
            this.liveState.status = 'finished';
            await this.syncAndRender('🏁 ¡Evento Concluido!');
            this.openReportModal();
            return;
        }

        await this.syncAndRender(`⚡ TAP: Cambio a bloque #${this.liveState.currentIndex + 1}`);
    }

    async omitBlock(itemNum, title) {
        if (this.role !== 'director' && this.role !== 'admin') return;
        if (confirm(`¿Omitir de la escaleta el bloque "${title}"?`)) {
            if (!this.liveState.omittedItemNums) this.liveState.omittedItemNums = [];
            this.liveState.omittedItemNums.push(itemNum);
            await this.syncAndRender(`Bloque "${title}" omitido. Escaleta recalculada.`);
        }
    }

    async resyncNow() {
        if (this.role !== 'director' && this.role !== 'admin') return;
        this.liveState.currentBlockStartTime = new Date().toISOString();
        await this.syncAndRender('⏱ Horario reajustado a partir de este instante');
    }

    async finishShow() {
        if (this.role !== 'director' && this.role !== 'admin') return;
        if (confirm('¿Finalizar oficialmente la ejecución del show en vivo?')) {
            this.liveState.status = 'finished';
            await this.syncAndRender('Evento finalizado');
            this.openReportModal();
        }
    }

    async resetLiveSession() {
        if (this.role !== 'director' && this.role !== 'admin') return;
        if (confirm('¿Restablecer la sesión en vivo al estado inicial de espera?')) {
            this.liveState = {
                status: 'idle',
                trackingMode: 'schedule',
                currentIndex: 0,
                currentBlockStartTime: null,
                omittedItemNums: [],
                mutedBlockNums: [],
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

        // 1.1 Update Play / Pause Buttons in Header and Toolbars
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

        // Mode switch buttons in toolbars
        ['btnModeSchedule', 'btnAdminModeSchedule'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.toggle('active', isSchedule);
        });
        ['btnModeManual', 'btnAdminModeManual'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.toggle('active', !isSchedule);
        });

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
            if (heroRemainingTimer) { heroRemainingTimer.innerText = firstItem ? LiveEngine.formatDurationSeconds(firstItem.duration * 60) : '00:00'; heroRemainingTimer.style.color = '#38bdf8'; }
            if (heroElapsedTimer) { heroElapsedTimer.innerText = '00:00'; }
            if (heroPlannedTimer && firstItem) { heroPlannedTimer.innerText = `${firstItem.duration} min`; }
            if (heroProjectedEnd) { heroProjectedEnd.innerText = snapshot.projectedEndTime || '--:--'; }
            if (heroProgressFill) heroProgressFill.style.width = '0%';
        }

        // 4. Render Table Rows
        const tbody = document.getElementById('liveTableBody');
        const thActions = document.getElementById('thActions');
        if (thActions) {
            thActions.innerText = (this.role === 'admin') ? 'Gestión Admin' : (this.role === 'director' ? 'Acción Director' : '');
        }

        if (tbody) {
            tbody.innerHTML = '';
            snapshot.items.forEach((r) => {
                const tr = document.createElement('tr');
                tr.className = `row-${r.rowState}`;

                let progressHtml = '';
                if (r.rowState === 'active') {
                    let fillClass = '';
                    if (snapshot.alertLevel === 'yellow') fillClass = 'fill-yellow';
                    if (snapshot.alertLevel === 'red' || snapshot.alertLevel === 'overtime') fillClass = 'fill-red';
                    progressHtml = `<div class="row-progress-fill ${fillClass}" style="width: ${snapshot.progressPercent}%;"></div>`;
                }

                let actionsHtml = '';

                // Actions for Admin
                if (this.role === 'admin') {
                    if (r.isMuted) {
                        actionsHtml = `<button class="btn-action-unmute" onclick="liveApp.unmuteBlock(${r.num}, '${r.title.replace(/'/g, "\\'")}')" title="Reactivar bloque e incluirlo nuevamente en los tiempos">🔊 Reactivar</button>`;
                    } else if (r.rowState === 'active' || r.rowState === 'future') {
                        actionsHtml = `<button class="btn-action-mute" onclick="liveApp.muteBlock(${r.num}, '${r.title.replace(/'/g, "\\'")}')" title="Silenciar y excluir este bloque de los tiempos">🔇 Silenciar</button>`;
                    } else {
                        actionsHtml = `<span style="color: #10b981; font-weight: 800; font-size: 11px;">✔ HECHO</span>`;
                    }
                } 
                // Actions for Director
                else if (this.role === 'director') {
                    if (r.isMuted) {
                        actionsHtml = `<span style="color: #9ca3af; font-size: 11px;">🔇 Silenciado</span>`;
                    } else if (r.rowState === 'active') {
                        actionsHtml = `<button class="btn-tap" style="padding: 4px 10px; font-size: 11px;" onclick="liveApp.tapNextBlock()">⚡ TAP</button>`;
                    } else if (r.rowState === 'future') {
                        actionsHtml = `<button class="btn-live-sec" style="padding: 4px 8px; font-size: 10px; color: #f87171;" onclick="liveApp.omitBlock(${r.num}, '${r.title.replace(/'/g, "\\'")}')">✕ Omitir</button>`;
                    } else {
                        actionsHtml = `<span style="color: #10b981; font-weight: 800; font-size: 11px;">✔ HECHO</span>`;
                    }
                }

                const badgeHtml = r.isMuted 
                    ? `<span class="badge badge-muted">🔇 SILENCIADO</span>` 
                    : `<span class="badge ${r.badgeClass}">${r.type}</span>`;

                const durationHtml = r.isMuted 
                    ? `<span style="color: #9ca3af; text-decoration: line-through;">${r.duration} min</span> <span style="font-size: 10px; color: #f87171;">(0 min)</span>` 
                    : `${r.duration} min`;

                tr.innerHTML = `
                    <td style="text-align: center; font-weight: bold; width: 40px; position: relative; z-index: 1;">
                        ${progressHtml}
                        ${r.num}
                    </td>
                    <td style="position: relative; z-index: 1;">${badgeHtml}</td>
                    <td style="font-weight: 700; position: relative; z-index: 1;">${r.title}</td>
                    <td class="time-cell" style="position: relative; z-index: 1;">${r.liveStart}</td>
                    <td style="font-weight: 700; position: relative; z-index: 1;">${durationHtml}</td>
                    <td class="time-cell" style="position: relative; z-index: 1;">${r.liveEnd}</td>
                    ${(this.role === 'admin' || this.role === 'director') ? `<td style="text-align: right; position: relative; z-index: 1;">${actionsHtml}</td>` : ''}
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
