/**
 * ApiClient
 * Hybrid storage client that interacts with Backend REST API and falls back to LocalStorage
 */
const ApiClient = {
    baseUrl: window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:3000',
    LOCAL_KEY: 'eventTimeProjects',
    isBackendAvailable: false,

    /**
     * Check if backend API is reachable
     */
    async checkBackendHealth() {
        try {
            const res = await fetch(`${this.baseUrl}/api/health`, { method: 'GET', signal: AbortSignal.timeout(1500) });
            if (res.ok) {
                this.isBackendAvailable = true;
                return true;
            }
        } catch (e) {
            this.isBackendAvailable = false;
        }
        return false;
    },

    /**
     * Get all saved projects
     */
    async getAllProjects() {
        const hasBackend = await this.checkBackendHealth();
        if (hasBackend) {
            try {
                const res = await fetch(`${this.baseUrl}/api/projects`);
                const json = await res.json();
                if (json.success && json.data) {
                    // Update local cache
                    localStorage.setItem(this.LOCAL_KEY, JSON.stringify(json.data));
                    return { source: 'api', data: json.data };
                }
            } catch (e) {
                console.warn('Fallo llamada a API, usando LocalStorage:', e);
            }
        }

        // LocalStorage fallback
        try {
            const raw = localStorage.getItem(this.LOCAL_KEY);
            const data = JSON.parse(raw || '{}');
            return { source: 'local', data };
        } catch (e) {
            return { source: 'local', data: {} };
        }
    },

    /**
     * Get single project by name
     */
    async getProject(name) {
        const all = await this.getAllProjects();
        return all.data ? all.data[name] : null;
    },

    /**
     * Save project data
     */
    async saveProject(projectData) {
        const eventName = (projectData.eventName || 'Proyecto sin Nombre').trim();
        projectData.eventName = eventName;
        projectData.updatedAt = new Date().toLocaleString();

        // Always save locally first
        let localProjects = {};
        try {
            localProjects = JSON.parse(localStorage.getItem(this.LOCAL_KEY) || '{}');
        } catch (e) {
            localProjects = {};
        }
        localProjects[eventName] = projectData;
        localStorage.setItem(this.LOCAL_KEY, JSON.stringify(localProjects));

        // Sync with API if available
        const hasBackend = await this.checkBackendHealth();
        if (hasBackend) {
            try {
                const res = await fetch(`${this.baseUrl}/api/projects`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify(projectData)
                });
                const resJson = await res.json();
                if (resJson.success) {
                    return { success: true, mode: 'api', message: `Proyecto "${eventName}" guardado en Servidor API` };
                }
            } catch (e) {
                console.warn('No se pudo sincronizar con API:', e);
            }
        }

        return { success: true, mode: 'local', message: `Proyecto "${eventName}" guardado en LocalStorage` };
    },

    /**
     * Delete project by name
     */
    async deleteProject(name) {
        // Delete locally
        try {
            let localProjects = JSON.parse(localStorage.getItem(this.LOCAL_KEY) || '{}');
            delete localProjects[name];
            localStorage.setItem(this.LOCAL_KEY, JSON.stringify(localProjects));
        } catch (e) {
            console.error('Error al borrar localmente:', e);
        }

        // Delete from backend API
        const hasBackend = await this.checkBackendHealth();
        if (hasBackend) {
            try {
                await fetch(`${this.baseUrl}/api/projects/${encodeURIComponent(name)}`, {
                    method: 'DELETE'
                });
            } catch (e) {
                console.warn('Error al borrar en API:', e);
            }
        }

        return { success: true, message: `Proyecto "${name}" eliminado` };
    }
};
