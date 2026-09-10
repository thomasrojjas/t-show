const express = require('express');
const cors = require('cors');
const { checkDbConnection } = require('./supabaseClient');
const billingRoutes = require('./routes/billing');
const saasRoutes = require('./routes/saas');
const storageRoutes = require('./routes/storage');
const contactRoutes = require('./routes/contact');
const operationsRoutes = require('./routes/operations');
const productionRoutes = require('./routes/production');
const erpRoutes = require('./routes/erp');
const syncRoutes = require('./routes/sync');
const integrationRoutes = require('./routes/integrations');
const notificationRoutes = require('./routes/notifications');
const { requestContext, securityHeaders, notFound, errorHandler } = require('./lib/http');
const { assertEnvironment } = require('./lib/environment');

assertEnvironment();
const app = express();
const PORT = process.env.PORT || 3000;
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);

app.disable('x-powered-by');
app.use(requestContext);
app.use(securityHeaders);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    const error = new Error('Origen no autorizado por CORS');
    error.status = 403;
    error.code = 'CORS_ORIGIN_DENIED';
    return callback(error);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Signature', 'X-Request-Id', 'X-Cron-Secret']
}));

// Los webhooks conservan el cuerpo original antes del parser JSON global.
app.use('/api', billingRoutes);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (req, res) => {
  const databaseAvailable = await checkDbConnection();
  return res.status(databaseAvailable ? 200 : 503).json({
    success: databaseAvailable,
    status: databaseAvailable ? 'ok' : 'degraded',
    app: 'T-Show API',
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
    dependencies: { database: databaseAvailable ? 'ok' : 'unavailable' }
  });
});

app.get('/api/config', (req, res) => res.json({
  success: true,
  requestId: req.requestId,
  data: {
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    mercadoPagoPublicKey: process.env.MP_PUBLIC_KEY || null,
    paymentsEnabled: process.env.PAYMENTS_ENABLED === 'true'
  }
}));

app.use('/api', saasRoutes);
app.use('/api', contactRoutes);
app.use('/api', storageRoutes);
app.use('/api', operationsRoutes);
app.use('/api', productionRoutes);
app.use('/api', erpRoutes);
app.use('/api', syncRoutes);
app.use('/api', integrationRoutes);
app.use('/api', notificationRoutes);
app.use('/api', notFound);
app.use(errorHandler);

if (require.main === module) app.listen(PORT, () => console.log(`T-Show API listening on ${PORT}`));
module.exports = app;
