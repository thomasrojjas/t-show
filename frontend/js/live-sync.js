/**
 * LiveSync
 * Real-time synchronization layer between Director controls and multiple Viewers
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
            const res = await fetch(`${this.baseUrl}/api/live?project=${encodeURIComponent(projectName)}`, {
                signal: AbortSignal.timeout(1200)
            });
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

    /**
     * Save live state to API and LocalStorage
     */
    async pushLiveState(projectName, liveState) {
        if (!projectName || !liveState) return;

        liveState.projectName = projectName;
        liveState.lastUpdated = new Date().toISOString();

        // Local cache
        localStorage.setItem(`liveState_${projectName}`, JSON.stringify(liveState));

        // Sync with API
        try {
            await fetch(`${this.baseUrl}/api/live`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify(liveState)
            });
        } catch (e) {
            // Offline mode
        }
    },

    /**
     * Start real-time polling listener for viewers
     */
    startListening(projectName, onUpdateCallback) {
        this.stopListening();
        this.pollInterval = setInterval(async () => {
            const state = await this.fetchLiveState(projectName);
            if (state && onUpdateCallback) {
                onUpdateCallback(state);
            }
        }, 1200);
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
