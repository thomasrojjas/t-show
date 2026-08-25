const rateLimit = require('express-rate-limit');

const MAX_FAILED_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10);
const LOCKOUT_MINUTES = parseInt(process.env.LOGIN_LOCKOUT_MINUTES || '15', 10);

// Primera barrera: limita por IP a nivel de red (rápido, en memoria, se reinicia con el proceso).
const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // por IP; el lockout real por cuenta vive en Postgres (users.failed_login_attempts)
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Demasiados intentos desde esta red. Intenta más tarde.' }
});

/** Devuelve true si la cuenta está bloqueada por intentos fallidos (lockout persistido en DB). */
function isLocked(user) {
    return !!(user.locked_until && new Date(user.locked_until) > new Date());
}

module.exports = { loginRateLimiter, isLocked, MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES };
