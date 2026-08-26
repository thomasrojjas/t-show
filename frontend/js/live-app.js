/**
 * Show Time - LiveApp
 * Main UI and execution controller for Single-Screen Stage Display, Director & Administrator Platform
 * Developed by BaseAndes Software (https://www.baseandes.com/)
 */

class LiveApp {
    constructor() {
        this.projectData = null;
        this.projectName = ''; // UUID del proyecto, se conserva por compatibilidad con UI
        this.role = 'viewer'; // 'viewer' | 'director' | 'admin'
        this.targetModalRole = 'director'; // 'director' | 'admin'
        

        this.liveState = {
            status: 'idle', // 'idle' | 'live' | 'paused' | 'finished'
            trackingMode: 'schedule', // 'schedule' | 'manual'
            currentIndex: 0,
            currentBlockStartTime: null,
            omittedItemNums: [],
            mutedBlockNums: [],
            blockExtensions: {},
            history: []
        };

        this.tickerInterval = null;
        this.lastScrolledIndex = -1;

        // Start clocks immediately
        this.startMasterClock();
        this.startTicker();

        // Initialize data
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

        const profile = await Auth.getProfile().catch(() => null);
        this.role = profile?.role === 'platform_admin' ? 'admin' : 'director';

        // Close dropdowns on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.extend-menu-container')) {
                const drop = document.getElementById('extendDropdown');
                if (drop) drop.classList.remove('show');
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeStageConfidenceDisplay();
                this.closeModal('pinModal');
                this.closeModal('reportModal');
            }
        });

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

        // Viewer privileged elements
        const btnToggleRole = document.getElementById('btnToggleRole');
        const btnShare = document.getElementById('btnShare');
        const btnPlan = document.getElementById('btnPlan');
        const btnHeaderPlay = document.getElementById('btnHeaderPlay');

        const isViewer = (this.role === 'viewer');

        if (adminBar) adminBar.style.display = (this.role === 'admin') ? 'flex' : 'none';
        if (directorBar) directorBar.style.display = (this.role === 'director') ? 'flex' : 'none';

        if (roleBadge) {
            roleBadge.className = `role-badge role-${this.role}`;
            if (this.role === 'admin') roleBadge.innerText = '👑 ADMIN';
            else if (this.role === 'director') roleBadge.innerText = '🎬 DIRECTOR';
            else roleBadge.style.display = 'none';
        }

        // Hide privileged controls from Viewer
        if (btnToggleRole) btnToggleRole.style.display = isViewer ? 'none' : 'inline-flex';
        if (btnShare) btnShare.style.display = isViewer ? 'none' : 'inline-flex';
        if (btnPlan) btnPlan.style.display = isViewer ? 'none' : 'inline-flex';
        if (btnHeaderPlay) btnHeaderPlay.style.display = isViewer ? 'none' : 'inline-flex';
    }

    toggleRoleModal() {
        this.setRoleAsViewer();
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
                if (hintText) hintText.innerHTML = '👑 <strong>Administrador:</strong> permisos asignados por tu cuenta.';
            } else {
                btnDirector.classList.add('btn-primary');
                btnDirector.classList.remove('btn-secondary');
                btnAdmin.classList.add('btn-secondary');
                btnAdmin.classList.remove('btn-primary');
                if (hintText) hintText.innerHTML = '🎬 <strong>Director:</strong> permisos asignados por tu membresía.';
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
        PrintExportManager.showToast('Los permisos se administran desde la cuenta; no se usan PINes.', 'info');
    }

    openModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('active');
    }

    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('active');
    }

    // --- FULLSCREEN MODES ---

    /**
     * MODO 2: Pantalla Completa de la Aplicación General (Header, Hero, Escaleta)
     */
    toggleAppFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            }
        }
    }

    /**
     * MODO 1: Pantalla Completa Hiperreducida para Artistas en Escenario (Confidence Monitor)
     */
    openStageConfidenceDisplay() {
        const stageModal = document.getElementById('stageConfidenceModal');
        if (stageModal) stageModal.classList.add('active');

        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
        this.render();
    }

    closeStageConfidenceDisplay() {
        const stageModal = document.getElementById('stageConfidenceModal');
        if (stageModal) stageModal.classList.remove('active');

        if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
        }
    }

    // --- PLAY / PAUSE & TRACKING CONTROLS ---

    async togglePlayPause() {
        if (this.liveState.status === 'live') {
            this.liveState.status = 'paused';
            await this.syncAndRender('⏸ Show Pausado');
        } else {
            this.liveState.status = 'live';
            if (!this.liveState.currentBlockStartTime) {
                this.liveState.currentBlockStartTime = new Date().toISOString();
            }
            const modeName = this.liveState.trackingMode === 'manual' ? 'Manual (Director)' : 'Según Horario';
            await this.syncAndRender(`▶ ¡Show en Vivo! (${modeName})`);
        }
    }

    async setTrackingMode(mode) {
        this.liveState.trackingMode = mode;
        if (mode === 'manual' && !this.liveState.currentBlockStartTime) {
            this.liveState.currentBlockStartTime = new Date().toISOString();
        }
        await this.syncAndRender(`Modo: ${mode === 'schedule' ? '🕒 Según Horario' : '⚡ Conducción Manual'}`);
    }

    // --- DIRECTOR & ADMIN ACTIONS ---

    async startShow() {
        this.liveState.status = 'live';
        this.liveState.currentIndex = 0;
        this.liveState.currentBlockStartTime = new Date().toISOString();
        this.liveState.history = [];
        await this.syncAndRender('▶ ¡Evento Iniciado en Vivo!');
    }

    async stopShow() {
        if (this.role !== 'admin') {
            alert('Solo el Administrador puede detener el show.');
            return;
        }
        if (confirm('¿Detener el programa/show en vivo? El cronómetro se pausará y los tiempos quedarán registrados.')) {
            this.liveState.status = 'paused';
            await this.syncAndRender('⏹ Show detenido');
        }
    }

    toggleExtendMenu() {
        const drop = document.getElementById('extendDropdown');
        if (drop) drop.classList.toggle('show');
    }

    async extendCurrentBlock(extraMinutes) {
        const drop = document.getElementById('extendDropdown');
        if (drop) drop.classList.remove('show');

        const snapshot = LiveEngine.computeLiveSnapshot(this.projectData, this.liveState);
        if (!snapshot || !snapshot.currentItem) return;

        const itemNum = snapshot.currentItem.num;
        if (!this.liveState.blockExtensions) this.liveState.blockExtensions = {};

        if (extraMinutes > 0) {
            this.liveState.blockExtensions[itemNum] = (this.liveState.blockExtensions[itemNum] || 0) + extraMinutes;
            await this.syncAndRender(`⏱ Bloque extendido en +${extraMinutes} min. Horarios recalculados.`);
        } else {
            await this.syncAndRender('⏱ Bloque en curso mantenido.');
        }
    }

    /**
     * TAP: Termina el bloque actual y pasa de inmediato al siguiente bloque
     */
    async tapNextBlock() {
        if (this.role !== 'director' && this.role !== 'admin') return;

        const now = new Date();
        const snapshot = LiveEngine.computeLiveSnapshot(this.projectData, this.liveState);
        const currentItem = snapshot ? snapshot.currentItem : null;

        if (currentItem) {
            const startMs = this.liveState.currentBlockStartTime ? new Date(this.liveState.currentBlockStartTime).getTime() : now.getTime();
            const actualDurationMinutes = Math.max(1, Math.round((now.getTime() - startMs) / 60000));

            if (!this.liveState.history) this.liveState.history = [];
            this.liveState.history.push({
                num: currentItem.num,
                type: currentItem.type,
                title: currentItem.title,
                plannedStart: currentItem.start,
                plannedDuration: currentItem.effectiveDuration || currentItem.duration,
                plannedEnd: currentItem.end,
                actualStart: new Date(startMs).toISOString(),
                actualStartFormatted: LiveEngine.formatTimeSeconds(new Date(startMs)),
                actualEnd: now.toISOString(),
                actualEndFormatted: LiveEngine.formatTimeSeconds(now),
                actualDurationMinutes: actualDurationMinutes,
                diffMinutes: actualDurationMinutes - (currentItem.effectiveDuration || currentItem.duration)
            });
        }

        // Force manual execution mode so the TAP index takes absolute effect
        this.liveState.trackingMode = 'manual';
        this.liveState.status = 'live';
        this.liveState.currentIndex = (this.liveState.currentIndex || 0) + 1;
        this.liveState.currentBlockStartTime = now.toISOString();

        const activeRemaining = snapshot ? snapshot.items.filter(i => !i.isMuted) : [];
        if (this.liveState.currentIndex >= activeRemaining.length) {
            this.liveState.status = 'finished';
            await this.syncAndRender('🏁 ¡Evento Concluido!');
            this.openReportModal();
            return;
        }

        await this.syncAndRender(`⚡ TAP ejecutado: Bloque #${this.liveState.currentIndex + 1} en curso`);
    }

    async muteBlock(itemNum, title) {
        if (this.role !== 'admin' && this.role !== 'director') {
            alert('Acceso restringido.');
            return;
        }
        if (confirm(`¿Silenciar y excluir de los tiempos el bloque "${title}"? Sigue figurando en la lista pero no suma tiempo.`)) {
            if (!this.liveState.mutedBlockNums) this.liveState.mutedBlockNums = [];
            if (!this.liveState.mutedBlockNums.includes(itemNum)) {
                this.liveState.mutedBlockNums.push(itemNum);
            }
            await this.syncAndRender(`🔇 Bloque "${title}" silenciado.`);
        }
    }

    async unmuteBlock(itemNum, title) {
        if (this.role !== 'admin' && this.role !== 'director') {
            alert('Acceso restringido.');
            return;
        }
        if (!this.liveState.mutedBlockNums) this.liveState.mutedBlockNums = [];
        this.liveState.mutedBlockNums = this.liveState.mutedBlockNums.filter(n => n !== itemNum);
        await this.syncAndRender(`🔊 Bloque "${title}" reactivado.`);
    }

    async resyncNow() {
        if (this.role !== 'director' && this.role !== 'admin') return;
        this.liveState.currentBlockStartTime = new Date().toISOString();
        await this.syncAndRender('⏱ Horario reajustado a partir del momento actual');
    }

    async resetLiveSession() {
        if (this.role !== 'director' && this.role !== 'admin') return;
        if (confirm('¿Restablecer la sesión en vivo al estado inicial?')) {
            this.liveState = {
                status: 'idle',
                trackingMode: 'schedule',
                currentIndex: 0,
                currentBlockStartTime: null,
                omittedItemNums: [],
                mutedBlockNums: [],
                blockExtensions: {},
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

    // --- RENDERING & AUTO-SCROLL ---

    render() {
        const snapshot = LiveEngine.computeLiveSnapshot(this.projectData, this.liveState);
        if (!snapshot) return;

        // 1. Title & Status
        const titleEl = document.getElementById('liveProjectTitle');
        if (titleEl) titleEl.innerText = this.projectName;

        const isLive = snapshot.status === 'live';
        const isSchedule = (this.liveState.trackingMode || 'schedule') === 'schedule';

        const statusBadge = document.getElementById('liveStatusBadge');
        if (statusBadge) {
            statusBadge.className = `live-badge-status status-${snapshot.status}`;
            if (snapshot.status === 'idle') statusBadge.innerText = '⏸ EN ESPERA';
            if (snapshot.status === 'live') statusBadge.innerText = isSchedule ? '🔴 EN VIVO' : '🔴 MANUAL';
            if (snapshot.status === 'paused') statusBadge.innerText = '⏸ EN PAUSA';
            if (snapshot.status === 'finished') statusBadge.innerText = '🏁 FINALIZADO';
        }

        // Header Play Button
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
                btnHeaderPlayText.innerText = 'PLAY / EN VIVO';
            }
        }

        // 2. Ambient Alert Border
        const borderEl = document.getElementById('screenAmbientBorder');
        if (borderEl) {
            borderEl.className = '';
            if (snapshot.alertLevel === 'yellow') borderEl.classList.add('screen-alert-yellow');
            if (snapshot.alertLevel === 'red') borderEl.classList.add('screen-alert-red');
            if (snapshot.alertLevel === 'overtime') borderEl.classList.add('screen-alert-overtime');
        }

        // 3. Stage Display Hero Card
        const heroBlockName = document.getElementById('heroBlockName');
        const heroTypeBadge = document.getElementById('heroTypeBadge');
        const heroTimerLabel = document.getElementById('heroTimerLabel');
        const heroRemainingTimer = document.getElementById('heroRemainingTimer');
        const heroElapsedTimer = document.getElementById('heroElapsedTimer');
        const heroPlannedTimer = document.getElementById('heroPlannedTimer');
        const heroProgressFill = document.getElementById('heroProgressFill');
        const heroProjectedEnd = document.getElementById('heroProjectedEnd');
        const heroNextBlockName = document.getElementById('heroNextBlockName');

        if (heroNextBlockName) {
            heroNextBlockName.innerText = snapshot.nextItem ? `${snapshot.nextItem.title} (${snapshot.nextItem.effectiveDuration}m)` : 'Cierre del Show';
        }

        if (snapshot.currentItem && snapshot.status === 'live') {
            if (heroBlockName) heroBlockName.innerText = snapshot.currentItem.title;
            if (heroTypeBadge) {
                heroTypeBadge.innerText = snapshot.currentItem.type;
                heroTypeBadge.className = `hero-type-badge ${snapshot.currentItem.badgeClass}`;
            }

            if (heroRemainingTimer && heroTimerLabel) {
                if (snapshot.isOvertime) {
                    heroTimerLabel.innerText = 'TIEMPO EN CONTRA ⛶';
                    heroRemainingTimer.innerText = `+${LiveEngine.formatDurationSeconds(snapshot.overtimeSeconds)}`;
                    heroRemainingTimer.classList.add('is-overtime');
                } else {
                    heroTimerLabel.innerText = 'TIEMPO RESTANTE ⛶';
                    heroRemainingTimer.innerText = LiveEngine.formatDurationSeconds(snapshot.remainingSeconds);
                    heroRemainingTimer.classList.remove('is-overtime');
                    heroRemainingTimer.style.color = snapshot.alertLevel === 'red' ? '#ef4444' : (snapshot.alertLevel === 'yellow' ? '#f59e0b' : '#34d399');
                }
            }

            if (heroElapsedTimer) {
                heroElapsedTimer.innerText = LiveEngine.formatDurationSeconds(snapshot.elapsedSeconds);
            }

            if (heroPlannedTimer) {
                heroPlannedTimer.innerText = `${snapshot.currentItem.effectiveDuration || snapshot.currentItem.duration} min`;
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
            if (heroRemainingTimer) { heroRemainingTimer.innerText = '00:00'; heroRemainingTimer.classList.remove('is-overtime'); heroRemainingTimer.style.color = '#10b981'; }
            if (heroProgressFill) heroProgressFill.style.width = '100%';
        } else if (snapshot.status === 'paused' && snapshot.currentItem) {
            if (heroBlockName) heroBlockName.innerText = `⏸ ${snapshot.currentItem.title} (En Pausa)`;
            if (heroTypeBadge) {
                heroTypeBadge.innerText = snapshot.currentItem.type;
                heroTypeBadge.className = `hero-type-badge ${snapshot.currentItem.badgeClass}`;
            }
            if (heroRemainingTimer && heroTimerLabel) {
                heroTimerLabel.innerText = 'PAUSADO ⛶';
                heroRemainingTimer.innerText = LiveEngine.formatDurationSeconds(snapshot.remainingSeconds);
                heroRemainingTimer.classList.remove('is-overtime');
                heroRemainingTimer.style.color = '#f59e0b';
            }
            if (heroElapsedTimer) heroElapsedTimer.innerText = LiveEngine.formatDurationSeconds(snapshot.elapsedSeconds);
            if (heroPlannedTimer) heroPlannedTimer.innerText = `${snapshot.currentItem.effectiveDuration || snapshot.currentItem.duration} min`;
            if (heroProjectedEnd) heroProjectedEnd.innerText = snapshot.projectedEndTime;
            if (heroProgressFill) {
                heroProgressFill.style.width = `${snapshot.progressPercent}%`;
                heroProgressFill.className = 'hero-progress-fill fill-yellow';
            }
        } else {
            const firstItem = snapshot.currentItem || (snapshot.items && snapshot.items[0]);
            if (heroBlockName) heroBlockName.innerText = firstItem ? `Listo: ${firstItem.title}` : 'Listo para Iniciar Pauta';
            if (heroTypeBadge && firstItem) {
                heroTypeBadge.innerText = firstItem.type;
                heroTypeBadge.className = `hero-type-badge ${firstItem.badgeClass}`;
            }
            if (heroRemainingTimer && heroTimerLabel) {
                heroTimerLabel.innerText = 'TIEMPO RESTANTE ⛶';
                heroRemainingTimer.innerText = firstItem ? LiveEngine.formatDurationSeconds(firstItem.duration * 60) : '00:00';
                heroRemainingTimer.classList.remove('is-overtime');
                heroRemainingTimer.style.color = '#38bdf8';
            }
            if (heroElapsedTimer) heroElapsedTimer.innerText = '00:00';
            if (heroPlannedTimer && firstItem) heroPlannedTimer.innerText = `${firstItem.duration} min`;
            if (heroProjectedEnd) heroProjectedEnd.innerText = snapshot.projectedEndTime || '--:--';
            if (heroProgressFill) heroProgressFill.style.width = '0%';
        }

        // 3.1 Stage Confidence Display Update (MODO 1: Pantalla Completa para Artistas)
        const stageConfModal = document.getElementById('stageConfidenceModal');
        const stageConfCurrentTitle = document.getElementById('stageConfCurrentTitle');
        const stageConfBadge = document.getElementById('stageConfBadge');
        const stageConfTimerLabel = document.getElementById('stageConfTimerLabel');
        const stageConfTimerValue = document.getElementById('stageConfTimerValue');
        const stageConfNextTitle = document.getElementById('stageConfNextTitle');
        const stageConfProgressFill = document.getElementById('stageConfProgressFill');

        if (stageConfModal && stageConfCurrentTitle && stageConfTimerValue) {
            const currentTitle = snapshot.currentItem ? snapshot.currentItem.title : (snapshot.items && snapshot.items[0] ? snapshot.items[0].title : 'Listo para Iniciar Pauta');
            const currentBadge = snapshot.currentItem ? snapshot.currentItem.type : 'SHOW';
            const nextTitle = snapshot.nextItem ? `${snapshot.nextItem.title} (${snapshot.nextItem.effectiveDuration}m)` : 'Cierre del Evento';

            stageConfCurrentTitle.innerText = currentTitle;
            if (stageConfBadge) stageConfBadge.innerText = currentBadge;
            if (stageConfNextTitle) stageConfNextTitle.innerText = nextTitle;

            if (snapshot.status === 'live' && snapshot.currentItem) {
                if (snapshot.isOvertime) {
                    if (stageConfTimerLabel) stageConfTimerLabel.innerText = '⚠️ TIEMPO EN CONTRA';
                    stageConfTimerValue.innerText = `+${LiveEngine.formatDurationSeconds(snapshot.overtimeSeconds)}`;
                    stageConfTimerValue.classList.add('is-overtime');
                } else {
                    if (stageConfTimerLabel) stageConfTimerLabel.innerText = 'TIEMPO RESTANTE';
                    stageConfTimerValue.innerText = LiveEngine.formatDurationSeconds(snapshot.remainingSeconds);
                    stageConfTimerValue.classList.remove('is-overtime');
                    stageConfTimerValue.style.color = snapshot.alertLevel === 'red' ? '#ef4444' : (snapshot.alertLevel === 'yellow' ? '#f59e0b' : '#34d399');
                }
            } else if (snapshot.status === 'paused') {
                if (stageConfTimerLabel) stageConfTimerLabel.innerText = '⏸ PAUSADO';
                stageConfTimerValue.innerText = LiveEngine.formatDurationSeconds(snapshot.remainingSeconds);
                stageConfTimerValue.classList.remove('is-overtime');
                stageConfTimerValue.style.color = '#f59e0b';
            } else if (snapshot.status === 'finished') {
                if (stageConfTimerLabel) stageConfTimerLabel.innerText = '🏁 FINALIZADO';
                stageConfTimerValue.innerText = '00:00';
                stageConfTimerValue.classList.remove('is-overtime');
                stageConfTimerValue.style.color = '#10b981';
            } else {
                if (stageConfTimerLabel) stageConfTimerLabel.innerText = 'TIEMPO RESTANTE (EN ESPERA)';
                const firstItem = snapshot.currentItem || (snapshot.items && snapshot.items[0]);
                stageConfTimerValue.innerText = firstItem ? LiveEngine.formatDurationSeconds(firstItem.duration * 60) : '00:00';
                stageConfTimerValue.classList.remove('is-overtime');
                stageConfTimerValue.style.color = '#38bdf8';
            }

            if (stageConfProgressFill) {
                stageConfProgressFill.style.width = `${snapshot.progressPercent}%`;
            }
        }

        // 4. Render Table Rows & Auto-Scroll to Active Block
        const tbody = document.getElementById('liveTableBody');
        const thActions = document.getElementById('thActions');
        const isOperator = (this.role === 'admin' || this.role === 'director');

        if (thActions) {
            thActions.style.display = isOperator ? '' : 'none';
        }

        if (tbody) {
            tbody.innerHTML = '';
            let activeRowElement = null;

            snapshot.items.forEach((r) => {
                const tr = document.createElement('tr');
                tr.className = `row-${r.rowState}`;
                tr.id = `scheduleRow_${r.num}`;

                let progressHtml = '';
                if (r.rowState === 'active') {
                    activeRowElement = tr;
                    let fillClass = '';
                    if (snapshot.alertLevel === 'yellow') fillClass = 'fill-yellow';
                    if (snapshot.alertLevel === 'red' || snapshot.alertLevel === 'overtime') fillClass = 'fill-red';
                    progressHtml = `<div class="row-progress-fill ${fillClass}" style="width: ${snapshot.progressPercent}%;"></div>`;
                }

                let actionsHtml = '';
                if (isOperator) {
                    if (r.isMuted) {
                        actionsHtml = `<button class="btn-action-unmute" onclick="liveApp.unmuteBlock(${r.num}, '${r.title.replace(/'/g, "\\'")}')" title="Reactivar bloque">🔊 Activar</button>`;
                    } else if (r.rowState === 'active' || r.rowState === 'future') {
                        actionsHtml = `<button class="btn-action-mute" onclick="liveApp.muteBlock(${r.num}, '${r.title.replace(/'/g, "\\'")}')" title="Silenciar bloque sin contabilizar tiempo">🔇 Silenciar</button>`;
                    } else {
                        actionsHtml = `<span style="color: #10b981; font-weight: 800; font-size: 10px;">✔ HECHO</span>`;
                    }
                }

                const badgeHtml = r.isMuted 
                    ? `<span class="badge badge-muted">🔇 SILENCIADO</span>` 
                    : `<span class="badge ${r.badgeClass}">${r.type}</span>`;

                const durationHtml = r.isMuted 
                    ? `<span style="color: #6b7280; text-decoration: line-through;">${r.originalDuration} min</span> <span style="font-size: 9px; color: #f87171;">(0m)</span>` 
                    : `${r.effectiveDuration} min`;

                tr.innerHTML = `
                    <td style="text-align: center; font-weight: bold; width: 45px; position: relative; z-index: 1;">
                        ${progressHtml}
                        ${r.num}
                    </td>
                    <td style="position: relative; z-index: 1;">${badgeHtml}</td>
                    <td style="font-weight: 700; position: relative; z-index: 1;">${r.title}</td>
                    <td class="time-cell" style="position: relative; z-index: 1;">${r.liveStart}</td>
                    <td style="font-weight: 700; position: relative; z-index: 1;">${durationHtml}</td>
                    <td class="time-cell" style="position: relative; z-index: 1;">${r.liveEnd}</td>
                    ${isOperator ? `<td style="text-align: right; position: relative; z-index: 1;">${actionsHtml}</td>` : ''}
                `;
                tbody.appendChild(tr);
            });

            // 5. Automatic Smooth Scroll into Active Block View
            if (activeRowElement && snapshot.currentIndex !== this.lastScrolledIndex) {
                this.lastScrolledIndex = snapshot.currentIndex;
                activeRowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
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
