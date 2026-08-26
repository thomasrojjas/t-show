/* Supabase Auth client. Credentials are handled only by Supabase. */
const Auth = (() => {
    let clientPromise;
    async function client() {
        if (!clientPromise) clientPromise = (async () => {
            const base = window.SHOWTIME_API_URL || window.location.origin;
            const response = await fetch(`${base}/api/config`);
            const config = await response.json();
            if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) throw new Error('Autenticación no configurada.');
            return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
        })();
        return clientPromise;
    }
    async function token() { const { data } = await (await client()).auth.getSession(); return data.session?.access_token || null; }
    async function api(path, options = {}) { const accessToken = await token(); const response = await fetch(`${window.SHOWTIME_API_URL || window.location.origin}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) } }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || 'No se pudo completar la solicitud.'); return body; }
    function normalizeRut(value) {
        const compact = String(value || '').replace(/[^0-9kK]/g, '').toUpperCase();
        if (compact.length < 8 || compact.length > 9) return '';
        return `${compact.slice(0, -1)}-${compact.slice(-1)}`;
    }
    async function register({ email, password, firstName, lastName, rut, phone }) {
        if (!email || password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
        const normalizedRut = normalizeRut(rut);
        if (!/^[0-9]{7,8}-[0-9K]$/.test(normalizedRut)) throw new Error('Ingresa un RUT válido, por ejemplo 12345678-9.');
        const { data, error } = await (await client()).auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/login.html`, data: { first_name: firstName.trim(), last_name: lastName.trim(), rut: normalizedRut, phone: String(phone).replace(/[\s()-]/g, '') } } });
        if (error) throw error;
        if (data.session) await api('/api/profile', { method: 'POST', body: JSON.stringify({ firstName, lastName, rut: normalizedRut, phone }) });
        return data;
    }
    async function login(email, password) { const { data, error } = await (await client()).auth.signInWithPassword({ email, password }); if (error) throw error; return data.user; }
    async function completeProfile(values) { return api('/api/profile', { method: 'POST', body: JSON.stringify(values) }); }
    async function currentUser() { const { data } = await (await client()).auth.getUser(); return data.user || null; }
    async function getProfile() { return (await api('/api/me')).data; }
    async function forgotPassword(email) { const { error } = await (await client()).auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login.html?reset=1` }); if (error) throw error; }
    async function updatePassword(password) { const { error } = await (await client()).auth.updateUser({ password }); if (error) throw error; }
    async function logout(redirect = true) { await (await client()).auth.signOut(); if (redirect) window.location.href = 'login.html'; }
    async function requireSession() { const user = await currentUser(); if (!user) { window.location.href = `login.html?redirect=${encodeURIComponent(location.pathname + location.search)}`; return null; } return user; }
    async function requireGlobalRole(roles) { const user = await requireSession(); if (!user) return null; const profile = await getProfile().catch(() => null); if (!profile || !roles.includes(profile.role)) { window.location.href = 'app.html'; return null; } return profile; }
    return { client, token, api, login, register, normalizeRut, completeProfile, currentUser, getProfile, forgotPassword, updatePassword, logout, requireSession, requireGlobalRole };
})();
