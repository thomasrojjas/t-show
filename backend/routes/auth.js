const express = require('express');
const bcrypt = require('bcrypt');
const { supabase } = require('../supabaseClient');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { loginRateLimiter, isLocked, MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

router.post('/login', loginRateLimiter, async (req, res) => {
    const { username, pin } = req.body || {};
    if (!username || !pin) {
        return res.status(400).json({ success: false, message: 'Usuario y PIN son requeridos' });
    }

    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username.trim())
        .maybeSingle();

    if (error) {
        return res.status(500).json({ success: false, message: 'Error consultando la cuenta' });
    }
    if (!user || !user.is_active) {
        return res.status(401).json({ success: false, message: 'Usuario o PIN incorrectos' });
    }
    if (isLocked(user)) {
        return res.status(429).json({ success: false, message: `Cuenta bloqueada temporalmente por intentos fallidos. Intenta en unos minutos.` });
    }

    const pinMatches = await bcrypt.compare(String(pin), user.pin_hash);

    if (!pinMatches) {
        const attempts = (user.failed_login_attempts || 0) + 1;
        const patch = { failed_login_attempts: attempts };
        if (attempts >= MAX_FAILED_ATTEMPTS) {
            patch.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
            patch.failed_login_attempts = 0;
        }
        await supabase.from('users').update(patch).eq('id', user.id);
        return res.status(401).json({ success: false, message: 'Usuario o PIN incorrectos' });
    }

    await supabase
        .from('users')
        .update({ failed_login_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() })
        .eq('id', user.id);

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    res.json({
        success: true,
        data: {
            accessToken,
            refreshToken,
            user: { id: user.id, username: user.username, role: user.role, displayName: user.display_name }
        }
    });
});

router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
        return res.status(400).json({ success: false, message: 'Falta el refresh token' });
    }

    let payload;
    try {
        payload = verifyRefreshToken(refreshToken);
    } catch {
        return res.status(401).json({ success: false, message: 'Refresh token inválido o expirado' });
    }

    const { data: user, error } = await supabase.from('users').select('*').eq('id', payload.sub).maybeSingle();
    if (error || !user || !user.is_active) {
        return res.status(401).json({ success: false, message: 'Sesión inválida' });
    }
    if ((user.token_version || 0) !== payload.tokenVersion) {
        return res.status(401).json({ success: false, message: 'Sesión revocada, vuelve a iniciar sesión' });
    }

    const accessToken = signAccessToken(user);
    res.json({ success: true, data: { accessToken } });
});

router.post('/logout', requireAuth, async (req, res) => {
    // Invalida todos los refresh tokens emitidos previamente subiendo token_version.
    const { data } = await supabase.from('users').select('token_version').eq('id', req.user.id).single();
    await supabase.from('users').update({ token_version: (data?.token_version || 0) + 1 }).eq('id', req.user.id);
    res.json({ success: true, message: 'Sesión cerrada' });
});

router.get('/me', requireAuth, (req, res) => {
    res.json({ success: true, data: req.user });
});

module.exports = router;
