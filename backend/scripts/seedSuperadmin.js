const bcrypt = require('bcrypt');
const { supabase } = require('../supabaseClient');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

/**
 * Idempotente: si ya existe algún usuario con role='superadmin', no hace nada.
 * Se llama en el arranque de server.js para que funcione en Render sin acceso a shell.
 */
async function ensureSuperadmin() {
    const username = process.env.SUPERADMIN_USERNAME;
    const pin = process.env.SUPERADMIN_PIN;

    if (!username || !pin) {
        console.warn('⚠️  SUPERADMIN_USERNAME/SUPERADMIN_PIN no configurados — no se creará superadmin automáticamente.');
        return;
    }

    const { data: existing, error: findErr } = await supabase
        .from('users')
        .select('id')
        .eq('role', 'superadmin')
        .limit(1);

    if (findErr) {
        console.error('No se pudo verificar si existe un superadmin:', findErr.message);
        return;
    }
    if (existing && existing.length > 0) return;

    const pinHash = await bcrypt.hash(String(pin), BCRYPT_ROUNDS);
    const { error: insertErr } = await supabase.from('users').insert({
        username,
        pin_hash: pinHash,
        role: 'superadmin',
        display_name: 'Superadmin BaseAndes'
    });

    if (insertErr) {
        console.error('Error creando el superadmin inicial:', insertErr.message);
        return;
    }
    console.log(`✅ Superadmin inicial creado: usuario "${username}"`);
}

module.exports = { ensureSuperadmin };
