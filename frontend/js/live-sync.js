/**
 * LiveSync
 * Real-time synchronization layer between Director/Admin controls and multiple Viewers
 */
const LiveSync = {
    baseUrl: window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:3000',
    pollInterval: null,

    /**
     * Get live state from API or LocalStorage
     */
    async fetchLiveState(projectName) {
        if (!projectName) return null;

        // Try API
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1200);
            const res = await fetch(`${this.baseUrl}/api/live?project=${encodeURIComponent(projectName)}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                const json = await res.json();
                if (json.success && json.data) {
                    localStorage.setItem(`liveState_${projectName}`, JSON.stringify(json.data));
                    return json.data;
                }
            }
        } catch (e) {
            // API not available, use local cache
        }

        // Fallback LocalStorage
        try {
            const raw = localStorage.getItem(`liveState_${projectName}`);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    },

    async pullLiveState(projectName) {
        return await this.fetchLiveState(projectName);
    },

    /**
     * Save live state to API and LocalStorage
     */
    async pushLiveState(projectName, liveState) {
        if (!projectName || !liveState) return;

        liveState.projectName = projectName;
        liveState.lastUpdated = new Date().toISOString();

        // Local cache
        try {
            localStorage.setItem(`liveState_${projectName}`, JSON.stringify(liveState));
        } catch (e) {}

        // Sync with API
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1500);
            await fetch(`${this.baseUrl}/api/live`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify(liveState),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
        } catch (e) {
            // Offline mode
        }
    },

    /**
     * Start real-time polling listener for viewers
     */
    startListening(projectName, onUpdateCallback) {
        this.stopListening();
        if (!projectName) return;
        this.pollInterval = setInterval(async () => {
            try {
                const state = await this.fetchLiveState(projectName);
                if (state && onUpdateCallback) {
                    onUpdateCallback(state);
                }
            } catch (e) {}
        }, 1200);
    },

    startLivePolling(projectName, onUpdateCallback) {
        this.startListening(projectName, onUpdateCallback);
    },

    /**
     * Stop polling
     */
    stopListening() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = LiveSync;
}
