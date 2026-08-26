const { supabase } = require('../supabaseClient');

async function requireAuthenticatedUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ success: false, message: 'Debes iniciar sesión.' });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ success: false, message: 'Sesión inválida o expirada.' });
  req.user = { ...data.user, token };
  next();
}
async function requireSupabaseAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ success: false, message: 'Debes iniciar sesión.' });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ success: false, message: 'Sesión inválida o expirada.' });
  req.user = { ...authData.user, token };
  const { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', req.user.id).maybeSingle();
  if (profileError || !profile) return res.status(403).json({ success: false, message: 'Perfil incompleto. Completa tu registro.' });
  req.user.profile = profile;
  next();
}

function requirePlatformAdmin(req, res, next) {
  if (req.user?.profile?.role !== 'platform_admin') return res.status(403).json({ success: false, message: 'Permiso de administrador requerido.' });
  next();
}
module.exports = { requireAuthenticatedUser, requireSupabaseAuth, requirePlatformAdmin };
