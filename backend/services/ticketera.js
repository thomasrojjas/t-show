const messages = {
  TICKETERA_NOT_CONFIGURED: 'La conexión con Ticketera no está configurada en el servidor.',
  TICKETERA_INVALID_CONFIG: 'La URL de Ticketera debe ser una dirección base HTTPS válida, sin rutas ni parámetros.',
  TICKETERA_UNAUTHORIZED: 'Ticketera rechazó las credenciales de integración. Contacta al administrador.',
  TICKETERA_INVALID_RESPONSE: 'Ticketera devolvió una respuesta incompatible. No se han actualizado las cifras.',
  TICKETERA_UNAVAILABLE: 'Ticketera no está disponible en este momento. Puedes volver a intentar.',
  TICKETERA_TIMEOUT: 'Ticketera tardó demasiado en responder. Espera un momento y vuelve a intentar.'
};

function failure(code) {
  return Object.assign(new Error(messages[code]), { code, status: code === 'TICKETERA_TIMEOUT' ? 504 :
    ['TICKETERA_NOT_CONFIGURED', 'TICKETERA_INVALID_CONFIG'].includes(code) ? 503 : 502 });
}

function configuration(env = process.env) {
  const base = String(env.TICKETERA_API_URL || '').trim();
  const key = String(env.TICKETERA_API_KEY || '').trim();
  if (!base || !key) throw failure('TICKETERA_NOT_CONFIGURED');
  let url;
  try { url = new URL(base); } catch { throw failure('TICKETERA_INVALID_CONFIG'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:'))) {
    throw failure('TICKETERA_INVALID_CONFIG');
  }
  return { base: url.origin, key };
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const numericFields = ['issued','checkedIn','grossSalesClp','approvedTickets','pendingPayments',
  'occupancyPercent','capacity','pendingAttendance'];

function validPayload(payload, kind) {
  if (!object(payload) || payload.success === false) return false;
  if (kind === 'events') return Array.isArray(payload.events) && payload.events.every(event =>
    object(event) && typeof event.id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(event.id) &&
    typeof event.name === 'string' && event.name.trim().length > 0 &&
    (event.date == null || typeof event.date === 'string'));
  const metrics = payload.metrics;
  return object(metrics) && numericFields.every(key => number(metrics[key])) &&
    Array.isArray(metrics.ticketTypes) && metrics.ticketTypes.every(type => object(type) &&
      typeof type.name === 'string' && number(type.issued)) &&
    Array.isArray(metrics.zones) && metrics.zones.every(zone => object(zone) &&
      typeof zone.zone === 'string' && number(zone.count));
}

function createClient({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 25000,
  logger = record => console.info(JSON.stringify(record)) } = {}) {
  async function request(path, kind, requestId) {
    const started = Date.now();
    const safePath = kind === 'events' ? '/api/integrations/tshow/events' : '/api/integrations/tshow/events/:id/metrics';
    let upstreamStatus = null, contentType = null, origin = null, timer, controller;
    let category = 'ok';
    try {
      const config = configuration(env);
      origin = config.base;
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetchImpl(config.base + path, {
        headers: { Authorization: `Bearer ${config.key}`, Accept: 'application/json' },
        signal: controller.signal, redirect: 'error'
      });
      upstreamStatus = response.status;
      contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!response.ok) throw failure([401,403].includes(response.status) ? 'TICKETERA_UNAUTHORIZED' : 'TICKETERA_UNAVAILABLE');
      if (contentType !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(contentType)) {
        throw failure('TICKETERA_INVALID_RESPONSE');
      }
      let payload;
      try { payload = await response.json(); } catch {
        throw failure(controller.signal.aborted ? 'TICKETERA_TIMEOUT' : 'TICKETERA_INVALID_RESPONSE');
      }
      if (!validPayload(payload, kind)) throw failure('TICKETERA_INVALID_RESPONSE');
      return payload;
    } catch (error) {
      const safeError = messages[error.code] ? error : failure(controller?.signal.aborted ? 'TICKETERA_TIMEOUT' : 'TICKETERA_UNAVAILABLE');
      category = safeError.code;
      throw safeError;
    } finally {
      clearTimeout(timer);
      logger({ event: 'ticketera.request', requestId, origin, path: safePath, upstreamStatus,
        contentType: contentType === 'application/json' ? 'application/json' : contentType ? 'other' : null,
        durationMs: Date.now() - started, category });
    }
  }
  return {
    events: requestId => request('/api/integrations/tshow/events', 'events', requestId),
    metrics: (id, requestId) => request(`/api/integrations/tshow/events/${encodeURIComponent(id)}/metrics`, 'metrics', requestId)
  };
}

module.exports = { createClient, configuration, validPayload };
