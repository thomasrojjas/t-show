(function () {
    const user = Auth.requireGlobalRole(['superadmin']);
    if (!user) return;

    document.getElementById('whoami').textContent = `${user.displayName} (${user.username})`;

    function baseUrl() {
        return window.SHOWTIME_API_URL || window.location.origin;
    }

    async function authFetch(path, options = {}) {
        const res = await fetch(`${baseUrl()}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${Auth.getToken()}`,
                ...(options.headers || {})
            }
        });
        if (res.status === 401) {
            const refreshed = await Auth.refreshAccessToken();
            if (refreshed) return authFetch(path, options);
            Auth.logout();
            return null;
        }
        return res.json();
    }

    function roleBadge(role) {
        return `<span class="badge badge-${role}">${role}</span>`;
    }

    async function loadUsers() {
        const body = await authFetch('/api/users');
        const tbody = document.getElementById('usersTableBody');
        if (!body || !body.success) {
            tbody.innerHTML = `<tr><td colspan="6">Error cargando usuarios</td></tr>`;
            return;
        }
        tbody.innerHTML = body.data.map(u => `
            <tr>
                <td>${escapeHtml(u.username)}</td>
                <td>${escapeHtml(u.display_name)}</td>
                <td>${roleBadge(u.role)}</td>
                <td>${u.is_active ? '<span class="badge" style="background:rgba(16,185,129,.15);color:#6ee7b7;">Activa</span>' : '<span class="badge badge-inactive">Inactiva</span>'}</td>
                <td>${new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-secondary" style="font-size:11px;padding:6px 10px;" onclick="AdminApp.toggleStatus('${u.id}', ${!u.is_active})">
                        ${u.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                </td>
            </tr>
        `).join('');
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    document.getElementById('createUserForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('createUserMsg');
        msg.style.display = 'none';

        const payload = {
            username: document.getElementById('newUsername').value.trim(),
            displayName: document.getElementById('newDisplayName').value.trim(),
            pin: document.getElementById('newPin').value.trim(),
            email: document.getElementById('newEmail').value.trim() || undefined,
            role: 'director'
        };

        const body = await authFetch('/api/users', { method: 'POST', body: JSON.stringify(payload) });
        if (!body || !body.success) {
            msg.textContent = (body && body.message) || 'Error creando el usuario';
            msg.style.display = 'block';
            return;
        }
        e.target.reset();
        loadUsers();
    });

    window.AdminApp = {
        async toggleStatus(userId, nextState) {
            await authFetch(`/api/users/${userId}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ isActive: nextState })
            });
            loadUsers();
        }
    };

    loadUsers();
})();
