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
    function isValidRut(value) {
        const normalized = normalizeRut(value);
        if (!/^[0-9]{7,8}-[0-9K]$/.test(normalized)) return false;
        const [digits, verifier] = normalized.split('-');
        let sum = 0; let multiplier = 2;
        for (let index = digits.length - 1; index >= 0; index -= 1) { sum += Number(digits[index]) * multiplier; multiplier = multiplier === 7 ? 2 : multiplier + 1; }
        const expected = 11 - (sum % 11);
        return verifier === (expected === 11 ? '0' : expected === 10 ? 'K' : String(expected));
    }
    function normalizePhone(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (/^9\d{8}$/.test(digits)) return `+56${digits}`;
        if (/^569\d{8}$/.test(digits)) return `+${digits}`;
        return '';
    }
    function isValidName(value) { const name = String(value || '').trim(); return name.length >= 2 && /^[A-Za-zÀ-ÖØ-öø-ÿÑñ]+(?:[ '\-][A-Za-zÀ-ÖØ-öø-ÿÑñ]+)*$/.test(name); }
    // Política única: ocho caracteres, al menos una letra y un número.
    // No se exige una combinación artificial de mayúsculas, minúsculas o símbolos.
    function isStrongPassword(value) { return typeof value === 'string' && value.length >= 8 && /\p{L}/u.test(value) && /\d/.test(value); }
    function passwordHint(value) {
        if (typeof value !== 'string' || value.length < 8) return 'Usa al menos 8 caracteres.';
        if (!/\p{L}/u.test(value)) return 'Añade al menos una letra.';
        if (!/\d/.test(value)) return 'Añade al menos un número.';
        return '';
    }
    function bindPasswordToggles(root = document) {
        root.querySelectorAll('input[type="password"]').forEach(input => {
            if (input.closest('.password-control') || input.parentElement?.querySelector('[data-password-toggle]')) return;
            const wrap = document.createElement('div');
            wrap.className = 'password-control';
            input.parentNode.insertBefore(wrap, input);
            wrap.appendChild(input);
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'password-toggle';
            button.dataset.passwordToggle = ''; button.setAttribute('aria-controls', input.id);
            button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', 'Mostrar contraseña'); button.textContent = 'Mostrar';
            wrap.appendChild(button);
        });
        root.querySelectorAll('[data-password-toggle]').forEach(toggle => {
            if (toggle.dataset.bound) return;
            const targetId = toggle.getAttribute('aria-controls');
            const input = targetId ? document.getElementById(targetId) : null;
            if (!input) return;
            toggle.dataset.bound = 'true';
            toggle.addEventListener('click', () => {
                const visible = input.type === 'text';
                input.type = visible ? 'password' : 'text';
                toggle.setAttribute('aria-pressed', String(!visible));
                toggle.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
                toggle.textContent = visible ? 'Mostrar' : 'Ocultar';
            });
        });
    }
    async function register({ email, password, firstName, lastName, rut, phone, invite }) {
        if (!isValidName(firstName) || !isValidName(lastName)) throw new Error('Nombre y apellido deben contener solo letras y tener al menos 2 caracteres.');
        if (!/^\S+@\S+\.\S+$/.test(String(email || '').trim())) throw new Error('Ingresa un correo válido.');
        if (!isStrongPassword(password)) throw new Error(passwordHint(password) || 'La contraseña no cumple la política de seguridad.');
        const normalizedRut = normalizeRut(rut);
        if (!isValidRut(normalizedRut)) throw new Error('Ingresa un RUT válido con dígito verificador, por ejemplo 12345678-9.');
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) throw new Error('Ingresa un teléfono chileno válido, por ejemplo +56912345678.');
        const inviteQuery = invite ? `?invite=${encodeURIComponent(invite)}` : '';
        const { data, error } = await (await client()).auth.signUp({ email: email.trim().toLowerCase(), password, options: { emailRedirectTo: `${window.location.origin}/login.html${inviteQuery}`, data: { first_name: firstName.trim(), last_name: lastName.trim(), rut: normalizedRut, phone: normalizedPhone } } });
        if (error) {
            if (/already registered|already exists/i.test(error.message)) throw new Error('Este correo ya está registrado. Inicia sesión o recupera tu contraseña.');
            if (/password/i.test(error.message)) throw new Error('Supabase rechazó la contraseña configurada. Revisa la política de autenticación del proyecto.');
            throw error;
        }
        if (data.session) {
            try { await api('/api/profile', { method: 'POST', body: JSON.stringify({ firstName, lastName, rut: normalizedRut, phone: normalizedPhone }) }); }
            catch (profileError) { throw new Error('La cuenta se creó, pero no pudimos guardar tu perfil. Intenta nuevamente.'); }
        }
        return data;
    }
    async function login(email, password) { const { data, error } = await (await client()).auth.signInWithPassword({ email, password }); if (error) throw error; return data.user; }
    async function completeProfile(values) { return api('/api/profile', { method: 'POST', body: JSON.stringify(values) }); }
    async function currentUser() { const { data } = await (await client()).auth.getUser(); return data.user || null; }
    async function getProfile() { return (await api('/api/me')).data; }
    async function forgotPassword(email) { const { error } = await (await client()).auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password.html' }); if (error) throw error; }
    async function updatePassword(password) { const { error } = await (await client()).auth.updateUser({ password }); if (error) throw error; }
    async function logout(redirect = true) { await (await client()).auth.signOut(); if (redirect) window.location.href = '/'; }
    async function acceptInvitation(invite) { if (!invite) return null; return api(`/api/invitations/${encodeURIComponent(invite)}/accept`, { method: 'POST' }); }
    async function requireSession() { const user = await currentUser(); if (!user) { window.location.href = `login.html?redirect=${encodeURIComponent(location.pathname + location.search)}`; return null; } return user; }
    async function requireGlobalRole(roles) { const user = await requireSession(); if (!user) return null; const profile = await getProfile().catch(() => null); if (!profile || !roles.includes(profile.role)) { window.location.href = 'app.html'; return null; } return profile; }
    return { client, token, api, login, register, acceptInvitation, normalizeRut, isValidRut, normalizePhone, isValidName, isStrongPassword, passwordHint, bindPasswordToggles, completeProfile, currentUser, getProfile, forgotPassword, updatePassword, logout, requireSession, requireGlobalRole };
})();
document.addEventListener('DOMContentLoaded', () => Auth.bindPasswordToggles());
