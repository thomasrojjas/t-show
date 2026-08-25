/**
 * T-Show - Cliente de sesión (usuario + PIN)
 * Todo el JWT es emitido y validado por el backend Express; este archivo solo
 * guarda/adjunta el token y redirige — nunca decide roles ni permisos por su cuenta.
 */
const Auth = (function () {
    const ACCESS_KEY = 'tshow_access_token';
    const REFRESH_KEY = 'tshow_refresh_token';
    const USER_KEY = 'tshow_user';

    function baseUrl() {
        return window.SHOWTIME_API_URL || window.location.origin;
    }

    function getToken() {
        return localStorage.getItem(ACCESS_KEY);
    }

    function getRefreshToken() {
        return localStorage.getItem(REFRESH_KEY);
    }

    function getCurrentUser() {
        try {
            return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
        } catch {
            return null;
        }
    }

    function setSession({ accessToken, refreshToken, user }) {
        localStorage.setItem(ACCESS_KEY, accessToken);
        if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
        if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    }

    function clearSession() {
        localStorage.removeItem(ACCESS_KEY);
        localStorage.removeItem(REFRESH_KEY);
        localStorage.removeItem(USER_KEY);
    }

    async function login(username, pin) {
        const res = await fetch(`${baseUrl()}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, pin })
        });
        const body = await res.json();
        if (!res.ok || !body.success) {
            throw new Error(body.message || 'No se pudo iniciar sesión');
        }
        setSession(body.data);
        return body.data.user;
    }

    async function refreshAccessToken() {
        const refreshToken = getRefreshToken();
        if (!refreshToken) return false;
        try {
            const res = await fetch(`${baseUrl()}/api/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });
            const body = await res.json();
            if (!res.ok || !body.success) return false;
            localStorage.setItem(ACCESS_KEY, body.data.accessToken);
            return true;
        } catch {
            return false;
        }
    }

    function logout(redirect = true) {
        const token = getToken();
        clearSession();
        if (token) {
            fetch(`${baseUrl()}/api/auth/logout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            }).catch(() => {});
        }
        if (redirect) window.location.href = 'login.html';
    }

    /** Llamar al boot de cada página protegida. Redirige a login si no hay sesión. */
    function requireSession() {
        if (!getToken()) {
            const next = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `login.html?redirect=${next}`;
            return null;
        }
        return getCurrentUser();
    }

    function requireGlobalRole(roles) {
        const user = requireSession();
        if (!user) return null;
        if (!roles.includes(user.role)) {
            window.location.href = 'index.html';
            return null;
        }
        return user;
    }

    return {
        login, logout, refreshAccessToken, requireSession, requireGlobalRole,
        getToken, getCurrentUser, clearSession
    };
})();
