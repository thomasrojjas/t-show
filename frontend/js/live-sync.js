/* Transport keeps revision and connection health explicit; writes are never queued offline. */
const LiveSync = {
    channel: null,
    async request(projectId, options = {}) {
        const token = await Auth.token();
        const response = await fetch(`${window.SHOWTIME_API_URL || location.origin}/api/projects/${encodeURIComponent(projectId)}/live`, {
            ...options, signal: AbortSignal.timeout(12000),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
        });
        const result = await response.json();
        if (!response.ok) { const error = new Error(result.message || 'No se pudo consultar la sesión.'); error.status = response.status; throw error; }
        if (!Number.isSafeInteger(result.version) || result.version < 0)
            throw new Error('El servicio en vivo se está actualizando. Espera unos momentos y recarga la sesión.');
        return result;
    },
    fetchLiveState(projectId) { return this.request(projectId); },
    pushLiveState(projectId, command, version) {
        return this.request(projectId, { method:'PUT', body: JSON.stringify({ ...command, expectedVersion: version }) });
    },
    async startListening(projectId, onUpdate, onStatus) {
        this.stopListening();
        const sb = await Auth.client();
        this.channel = sb.channel(`live:${projectId}`).on('postgres_changes', {
            event: '*', schema:'public', table:'tshow_live_sessions', filter:`project_id=eq.${projectId}`
        }, payload => { if (payload.new?.state) onUpdate({ data:payload.new.state, version:payload.new.revision || 0 }); })
            .subscribe(status => onStatus(status === 'SUBSCRIBED' ? 'subscribed' : 'reconnecting'));
    },
    stopListening() { if (this.channel) { this.channel.unsubscribe(); this.channel = null; } }
};
