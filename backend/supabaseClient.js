const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('⚠️  SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no están configuradas. La API fallará al intentar acceder a la base de datos.');
}

// Cliente server-side únicamente. Usa la service role key, que bypassea RLS,
// por eso este cliente NUNCA debe exponerse al frontend ni viajar en una respuesta HTTP.
const supabase = createClient(SUPABASE_URL || '', SUPABASE_SERVICE_ROLE_KEY || '', {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function checkDbConnection() {
    try {
        const { error } = await supabase.from('profiles').select('id').limit(1);
        if (error) throw error;
        return true;
    } catch (err) {
        console.error('Error de conexión a Supabase:', err.message);
        return false;
    }
}

module.exports = { supabase, checkDbConnection };
