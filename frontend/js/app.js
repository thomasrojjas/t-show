/**
 * EventTime Pro Main Application Controller
 */

const initialDefaultBlocks = [
    { id: 'b1', type: 'ANIMACIÓN', title: 'Animadores: Bienvenida & Presentación Inicial', duration: 15, bis: 0 },
    { id: 'b2', type: 'SHOW', title: 'Artista 1 - Show Principal', duration: 55, bis: 10 },
    { id: 'b3', type: 'ANIMACIÓN', title: 'Animadores: Concursos / Intervención', duration: 15, bis: 0 },
    { id: 'b4', type: 'SHOW', title: 'Artista 2 - Show Estelar', duration: 60, bis: 15 },
    { id: 'b5', type: 'SHOW', title: 'Coronación', duration: 30, bis: 0 },
    { id: 'b6', type: 'ANIMACIÓN', title: 'Animadores: Intervención / Sorteo', duration: 10, bis: 0 },
    { id: 'b7', type: 'SHOW', title: 'Artista 4 - Presentation', duration: 60, bis: 10 },
    { id: 'b8', type: 'ANIMACIÓN', title: 'Animadores: Despedida & Cierre del Evento', duration: 10, bis: 0 }
];

class App {
    constructor() {
        this.blocksManager = null;
        this.currentProjectId = null;
        this.init();
    }

    init() {
        // Initialize Blocks Manager
        this.blocksManager = new BlocksManager('blocksContainer', () => this.calculateTiming());
        this.blocksManager.setBlocks(initialDefaultBlocks);

        // Bind form inputs
        this.bindEvents();

        // Check backend and render saved projects
        this.renderSavedProjects();

        // Initial Calculation
        this.toggleShowStartMode();
    }

    bindEvents() {
        const inputs = [
            'eventName',
            'convocatoriaTime',
            'convocatoriaDuration',
            'doorsTime',
            'doorsDuration',
            'showStartTimeInput'
        ];

        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => this.calculateTiming());
                el.addEventListener('change', () => this.calculateTiming());
            }
        });

        const modeSelect = document.getElementById('showStartMode');
        if (modeSelect) {
            modeSelect.addEventListener('change', () => this.toggleShowStartMode());
        }
    }

    toggleShowStartMode() {
        const mode = document.getElementById('showStartMode').value;
        const input = document.getElementById('showStartTimeInput');
        if (mode === 'auto') {
            input.readOnly = true;
            input.style.opacity = '0.7';
            input.title = 'Calculado automáticamente a partir de la apertura de puertas + ambientación';
        } else {
            input.readOnly = false;
            input.style.opacity = '1';
            input.title = 'Horario de inicio personalizado';
        }
        this.calculateTiming();
    }

    getFormData() {
        return {
            eventName: document.getElementById('eventName').value || 'Gran Concierto & Show Estelar',
            convocatoriaTime: document.getElementById('convocatoriaTime').value || '18:30',
            convocatoriaDuration: parseInt(document.getElementById('convocatoriaDuration').value) || 0,
            doorsTime: document.getElementById('doorsTime').value || '19:30',
            doorsDuration: parseInt(document.getElementById('doorsDuration').value) || 0,
            showStartMode: document.getElementById('showStartMode').value || 'auto',
            showStartTimeInput: document.getElementById('showStartTimeInput').value || '20:30',
            blocks: this.blocksManager.getBlocks()
        };
    }

    calculateTiming() {
        const formData = this.getFormData();
        
        // Update Title Display
        const titleEl = document.getElementById('displayEventTitle');
        if (titleEl) titleEl.innerText = formData.eventName;
        const printTitleEl = document.getElementById('printEventTitle');
        if (printTitleEl) printTitleEl.innerText = formData.eventName;

        // Run computation in Timing Engine
        const result = TimingEngine.computeSchedule(formData, formData.blocks);

        // If auto mode, sync input value
        if (formData.showStartMode === 'auto') {
            document.getElementById('showStartTimeInput').value = result.metrics.showStartTimeFormatted;
        }

        // Update Top Metric Cards
        document.getElementById('metricConvTime').innerText = result.metrics.convocatoriaTimeFormatted;
        document.getElementById('metricDoorsTime').innerText = result.metrics.doorsTimeFormatted;
        document.getElementById('metricShowStartTime').innerText = result.metrics.showStartTimeFormatted;
        document.getElementById('metricEndTime').innerText = result.metrics.endTimeFormatted;
        document.getElementById('metricTotalDuration').innerText = result.metrics.totalDurationFormatted;

        // Update Timeline Header Text
        const timelineSpanEl = document.getElementById('timelineTotalSpan');
        if (timelineSpanEl) {
            timelineSpanEl.innerText = `${result.metrics.convocatoriaTimeFormatted} A ${result.metrics.endTimeFormatted} (${result.metrics.totalDurationFormatted.toUpperCase()})`;
        }

        // Render Table Rows
        const tbody = document.getElementById('timingTableBody');
        if (tbody) {
            tbody.innerHTML = '';
            result.tableRows.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="text-align: center; font-weight: bold; color: #94a3b8;">${r.num}</td>
                    <td><span class="badge ${r.badgeClass}">${r.type}</span></td>
                    <td style="font-weight: 600;">${r.title}</td>
                    <td class="time-cell">${r.start}</td>
                    <td style="font-weight: 600;">${r.duration} min</td>
                    <td class="time-cell">${r.end}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        // Render Timeline Bar Segments
        const timelineBar = document.getElementById('timelineBar');
        if (timelineBar) {
            timelineBar.innerHTML = '';
            const totalMinutes = Math.max(1, result.totalDurationMinutes);

            result.tableRows.forEach(r => {
                const pct = (r.duration / totalMinutes) * 100;
                const seg = document.createElement('div');
                seg.className = 'timeline-segment';
                seg.style.width = `${pct}%`;
                seg.style.backgroundColor = r.color;
                seg.innerText = pct > 5.5 ? `${r.start}` : '';
                seg.setAttribute('data-tooltip', `[${r.type}] ${r.title} (${r.duration} min | ${r.start} - ${r.end})`);
                timelineBar.appendChild(seg);
            });
        }
    }

    async saveProject() {
        try {
            const data = { ...this.getFormData(), ...(this.currentProjectId ? { id: this.currentProjectId } : {}) };
            const res = await ApiClient.saveProject(data);
            this.currentProjectId = res.data?.id || this.currentProjectId;
            PrintExportManager.showToast(res.message || 'Proyecto guardado con éxito', 'success');
            this.renderSavedProjects();
        } catch (error) {
            PrintExportManager.showToast(error.message || 'No se pudo guardar el proyecto.', 'danger');
        }
    }

    async loadProject(id) {
        const project = await ApiClient.getProject(id);
        if (project) {
            document.getElementById('eventName').value = project.eventName || '';
            if (project.convocatoriaTime) document.getElementById('convocatoriaTime').value = project.convocatoriaTime;
            if (project.convocatoriaDuration !== undefined) document.getElementById('convocatoriaDuration').value = project.convocatoriaDuration;
            if (project.doorsTime) document.getElementById('doorsTime').value = project.doorsTime;
            if (project.doorsDuration !== undefined) document.getElementById('doorsDuration').value = project.doorsDuration;
            if (project.showStartMode) document.getElementById('showStartMode').value = project.showStartMode;
            if (project.showStartTimeInput) document.getElementById('showStartTimeInput').value = project.showStartTimeInput;

            this.blocksManager.setBlocks(project.blocks || []);
            this.toggleShowStartMode();
            this.currentProjectId = project.id;
            PrintExportManager.showToast(`Proyecto "${project.eventName}" cargado`, 'info');
        }
    }

    async deleteProject(id) {
        if (confirm('¿Estás seguro de eliminar este proyecto?')) {
            const res = await ApiClient.deleteProject(id);
            if (this.currentProjectId === id) this.currentProjectId = null;
            PrintExportManager.showToast(res.message || 'Proyecto eliminado', 'danger');
            this.renderSavedProjects();
        }
    }

    async renderSavedProjects() {
        const container = document.getElementById('savedProjectsContainer');
        const badgeEl = document.getElementById('storageBadge');
        if (!container) return;

        const result = await ApiClient.getAllProjects();
        const projects = result.data || {};
        const ids = Object.keys(projects);

        if (badgeEl) {
            if (result.source === 'api') {
                badgeEl.innerText = 'Servidor REST Conectado';
                badgeEl.style.color = 'var(--accent-success)';
            } else {
                badgeEl.innerText = 'Almacenamiento Local';
                badgeEl.style.color = 'var(--accent-warning)';
            }
        }

        if (ids.length === 0) {
            container.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 10px;">No hay proyectos guardados aún</div>';
            return;
        }

        container.innerHTML = '';
        ids.forEach(id => {
            const project = projects[id];
            const chip = document.createElement('div');
            chip.className = 'project-chip';
            chip.innerHTML = `
                <span style="font-weight: 600; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" onclick="app.loadProject('${id}')">${project.eventName}</span>
                <div style="display: flex; gap: 4px;">
                    <button class="btn-icon" title="Cargar proyecto" onclick="app.loadProject('${id}')">Cargar</button>
                    ${project.permission === 'owner' ? `<button class="btn-icon" style="color: var(--accent-danger);" title="Eliminar proyecto" onclick="app.deleteProject('${id}')">Eliminar</button>` : ''}
                </div>
            `;
            container.appendChild(chip);
        });
    }

    resetToDefaults() {
        if (confirm('¿Restablecer todos los campos a la configuración inicial por defecto?')) {
            document.getElementById('eventName').value = 'Gran Concierto & Show Estelar';
            document.getElementById('convocatoriaTime').value = '18:30';
            document.getElementById('convocatoriaDuration').value = '30';
            document.getElementById('doorsTime').value = '19:30';
            document.getElementById('doorsDuration').value = '60';
            document.getElementById('showStartMode').value = 'auto';
            document.getElementById('showStartTimeInput').value = '20:30';

            this.blocksManager.setBlocks(initialDefaultBlocks);
            this.toggleShowStartMode();
            PrintExportManager.showToast('Configuración restablecida', 'info');
        }
    }

    exportCurrentProjectJSON() {
        const data = this.getFormData();
        PrintExportManager.exportJSON(data);
    }

    openLive() {
        if (!this.currentProjectId) return PrintExportManager.showToast('Primero guarda el proyecto para abrir el modo en vivo.', 'warning');
        window.location.href = `live.html?project=${encodeURIComponent(this.currentProjectId)}`;
    }

    print() {
        PrintExportManager.triggerPrint();
    }
}

// Global functions for inline HTML button bindings
function saveProject() { app.saveProject(); }
function resetToDefaults() { app.resetToDefaults(); }
function addBlock(type) { app.blocksManager.addBlock(type); }
function toggleShowStartMode() { app.toggleShowStartMode(); }
function calculateTiming() { app.calculateTiming(); }
function exportProject() { app.exportCurrentProjectJSON(); }

// Initialize when DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new App();
    window.app = app;
});
