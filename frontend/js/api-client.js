const ApiClient = {
    baseUrl: () => window.SHOWTIME_API_URL || window.location.origin,
    async request(path, options = {}) { return Auth.api(`/api${path}`, options); },
    async getAllProjects() { const result = await this.request('/projects'); const data = {}; result.data.forEach(project => { data[project.id] = { ...project.payload, id: project.id, eventName: project.event_name, updatedAt: project.updated_at, permission: project.member_role || (project.owner_id ? 'owner' : 'viewer') }; }); return { source: 'api', data }; },
    async getProject(id) { const result = await this.request(`/projects/${encodeURIComponent(id)}`); return { ...result.data.payload, id: result.data.id, eventName: result.data.event_name, permission: result.data.permission }; },
    async saveProject(projectData) { const id = projectData.id; const response = await this.request(id ? `/projects/${id}` : '/projects', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(projectData) }); projectData.id = response.data.id; return { success: true, mode: 'api', data: response.data }; },
    async deleteProject(id) { await this.request(`/projects/${id}`, { method: 'DELETE' }); return { success: true }; }
};
