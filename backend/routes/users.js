const express = require('express');
const bcrypt = require('bcrypt');
const { supabase } = require('../supabaseClient');
const { requireAuth } = require('../middleware/auth');
const { requireGlobalRole } = require('../middleware/requireRole');

const router = express.Router();
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
const PIN_REGEX = /^\d{4,6}$/;

router.use(requireAuth);

function sanitizeUser(user) {
    const { pin_hash, failed_login_attempts, locked_until, token_version, ...safe } = user;
    return safe;
}

// Superadmin crea cuentas "director". Un director crea "editor"/"viewer" — pero SOLO
// dentro del contexto de un proyecto (ver routes/projectMembers.js), no aquí en general,
// para evitar que un director cree cuentas sueltas sin asignarlas a ningún proyecto suyo.
router.post('/', requireGlobalRole(['superadmin']), async (req, res) => {
    const { username, pin, displayName, role, email } = req.body || {};

    if (!username || !pin || !displayName || !role) {
        return res.status(400).json({ success: false, message: 'username, pin, displayName y role son requeridos' });
    }
    if (!PIN_REGEX.test(String(pin))) {
        return res.status(400).json({ success: false, message: 'El PIN debe ser numérico de 4 a 6 dígitos' });
    }
    if (!['director', 'editor', 'viewer'].includes(role)) {
        return res.status(400).json({ success: false, message: 'Rol inválido' });
    }

    const pinHash = await bcrypt.hash(String(pin), BCRYPT_ROUNDS);
    const { data, error } = await supabase
        .from('users')
        .insert({
            username: username.trim(),
            pin_hash: pinHash,
            display_name: displayName,
            role,
            email: email || null,
            created_by: req.user.id
        })
        .select()
        .single();

    if (error) {
        if (error.code === '23505') {
            return res.status(409).json({ success: false, message: 'Ese nombre de usuario ya existe' });
        }
        return res.status(500).json({ success: false, message: 'Error creando el usuario' });
    }

    res.status(201).json({ success: true, data: sanitizeUser(data) });
});

// Listado — solo superadmin ve todos los usuarios.
router.get('/', requireGlobalRole(['superadmin']), async (req, res) => {
    const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, message: 'Error listando usuarios' });
    res.json({ success: true, data: data.map(sanitizeUser) });
});

// Resetear PIN — superadmin sobre cualquiera, o un director sobre alguien que él mismo creó.
router.post('/:id/reset-pin', async (req, res) => {
    const { pin } = req.body || {};
    if (!PIN_REGEX.test(String(pin))) {
        return res.status(400).json({ success: false, message: 'El PIN debe ser numérico de 4 a 6 dígitos' });
    }

    const { data: target, error: findErr } = await supabase.from('users').select('*').eq('id', req.params.id).maybeSingle();
    if (findErr || !target) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const isSuperadmin = req.user.role === 'superadmin';
    const isCreator = target.created_by === req.user.id && req.user.role === 'director';
    if (!isSuperadmin && !isCreator) {
        return res.status(403).json({ success: false, message: 'No tienes permiso para resetear este PIN' });
    }

    const pinHash = await bcrypt.hash(String(pin), BCRYPT_ROUNDS);
    const { error } = await supabase
        .from('users')
        .update({ pin_hash: pinHash, failed_login_attempts: 0, locked_until: null, token_version: (target.token_version || 0) + 1 })
        .eq('id', target.id);

    if (error) return res.status(500).json({ success: false, message: 'Error reseteando el PIN' });
    res.json({ success: true, message: 'PIN actualizado' });
});

// Activar/desactivar cuenta — mismas reglas de propiedad que reset-pin.
router.patch('/:id/status', async (req, res) => {
    const { isActive } = req.body || {};
    if (typeof isActive !== 'boolean') {
        return res.status(400).json({ success: false, message: 'isActive debe ser booleano' });
    }

    const { data: target, error: findErr } = await supabase.from('users').select('*').eq('id', req.params.id).maybeSingle();
    if (findErr || !target) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const isSuperadmin = req.user.role === 'superadmin';
    const isCreator = target.created_by === req.user.id && req.user.role === 'director';
    if (!isSuperadmin && !isCreator) {
        return res.status(403).json({ success: false, message: 'No tienes permiso sobre esta cuenta' });
    }

    const { error } = await supabase.from('users').update({ is_active: isActive }).eq('id', target.id);
    if (error) return res.status(500).json({ success: false, message: 'Error actualizando la cuenta' });
    res.json({ success: true, message: isActive ? 'Cuenta activada' : 'Cuenta desactivada' });
});

module.exports = router;
