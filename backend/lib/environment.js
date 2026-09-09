const CORE_REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];
const FEATURES = {
  email: ['RESEND_API_KEY', 'RESEND_FROM', 'FRONTEND_URL'],
  r2: ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'],
  mercadoPago: ['MP_ACCESS_TOKEN', 'MP_PUBLIC_KEY', 'MP_WEBHOOK_SECRET', 'PUBLIC_API_URL'],
  flow: ['FLOW_API_KEY', 'FLOW_SECRET_KEY', 'FLOW_API_URL', 'PUBLIC_API_URL'],
  ticketera: ['TICKETERA_API_URL', 'TICKETERA_API_KEY']
};
const missing = names => names.filter(name => !String(process.env[name] || '').trim());

function inspectEnvironment() {
  const errors = missing(CORE_REQUIRED).map(name => `Falta la variable obligatoria ${name}.`);
  const warnings = [];
  for (const [feature, names] of Object.entries(FEATURES)) {
    const absent = missing(names);
    if (absent.length && absent.length !== names.length) warnings.push(`${feature}: configuración incompleta (${absent.join(', ')}).`);
  }
  if (process.env.NODE_ENV === 'production' && missing(['CORS_ORIGIN', 'FRONTEND_URL', 'PUBLIC_API_URL']).length) errors.push('Producción requiere CORS_ORIGIN, FRONTEND_URL y PUBLIC_API_URL.');
  return { valid: errors.length === 0, errors, warnings };
}

function assertEnvironment() {
  const report = inspectEnvironment();
  report.warnings.forEach(message => console.warn(`[config] ${message}`));
  if (!report.valid && process.env.NODE_ENV === 'production') throw new Error(`Configuración inválida: ${report.errors.join(' ')}`);
  report.errors.forEach(message => console.warn(`[config] ${message}`));
  return report;
}

module.exports = { inspectEnvironment, assertEnvironment };
