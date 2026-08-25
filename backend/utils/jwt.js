const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET;
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

if (!JWT_SECRET) {
    console.warn('⚠️  JWT_SECRET no está configurado. Define una clave larga y aleatoria en las variables de entorno.');
}

function signAccessToken(user) {
    return jwt.sign(
        { sub: user.id, username: user.username, role: user.role, displayName: user.display_name },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

function signRefreshToken(user) {
    return jwt.sign(
        { sub: user.id, tokenVersion: user.token_version || 0, type: 'refresh' },
        JWT_REFRESH_SECRET,
        { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
}

function verifyAccessToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

function verifyRefreshToken(token) {
    return jwt.verify(token, JWT_REFRESH_SECRET);
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
