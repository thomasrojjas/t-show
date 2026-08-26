const LiveSync = {
    channel: null,
    async fetchLiveState(projectId) { const body = await Auth.api(`/api/projects/${encodeURIComponent(projectId)}/live`); return body.data; },
    async pushLiveState(projectId, state) { return Auth.api(`/api/projects/${encodeURIComponent(projectId)}/live`, { method: 'PUT', body: JSON.stringify(state) }); },
    async startListening(projectId, onUpdate) {
        this.stopListening(); const sb = await Auth.client();
        this.channel = sb.channel(`live:${projectId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'tshow_live_sessions', filter: `project_id=eq.${projectId}` }, payload => onUpdate(payload.new?.state)).subscribe();
    },
    startLivePolling(projectId, onUpdate) { return this.startListening(projectId, onUpdate); },
    stopListening() { if (this.channel) { this.channel.unsubscribe(); this.channel = null; } }
};
