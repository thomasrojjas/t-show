const ApiClient = {
    baseUrl: () => window.SHOWTIME_API_URL || window.location.origin,
    async request(path, options = {}) { return Auth.api(`/api${path}`, options); },
    async getAllProjects() { const result = await this.request('/projects'); const data = {}; result.data.forEach(project => { data[project.id] = { ...project.payload, id: project.id, eventName: project.event_name, updatedAt: project.updated_at, ownerId: project.owner_id, coverKey: project.cover_key, permission: project.member_role || 'owner' }; }); return { source: 'api', data, meta: result.meta || { ownedCount: 0, limit: 1, remaining: 1, plan: 'free', subscriptionStatus: 'free' } }; },
    async getProject(id) { const result = await this.request(`/projects/${encodeURIComponent(id)}`); return { ...result.data.payload, id: result.data.id, eventName: result.data.event_name, coverKey: result.data.cover_key, permission: result.data.permission }; },
    async saveProject(projectData) { const id = projectData.id; const response = await this.request(id ? `/projects/${id}` : '/projects', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(projectData) }); projectData.id = response.data.id; return { success: true, mode: 'api', data: response.data }; },
    async deleteProject(id) { await this.request(`/projects/${id}`, { method: 'DELETE' }); return { success: true }; },
    async updateProjectIdentity(id, identity) { return this.request(`/projects/${encodeURIComponent(id)}/identity`, { method: 'PATCH', body: JSON.stringify(identity) }); },
    async duplicateProject(id) { return this.request(`/projects/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }); },
    async signedFileUrl(key) { const path = String(key).split('/').map(encodeURIComponent).join('/'); return this.request(`/uploads/${path}/url`, { method: 'POST' }); }
};
