const { verifyAccessToken } = require('../utils/jwt');

/**
 * Exige un access token válido en el header Authorization: Bearer <token>.
 * El rol y datos del usuario vienen del propio JWT (firmado por Express) —
 * el frontend nunca puede inventarse un rol, ya que no puede firmar el token.
 */
function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    try {
        const payload = verifyAccessToken(token);
        req.user = {
            id: payload.sub,
            username: payload.username,
            role: payload.role,
            displayName: payload.displayName
        };
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Sesión inválida o expirada' });
    }
}

module.exports = { requireAuth };
