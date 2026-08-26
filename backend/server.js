const express = require('express');
const cors = require('cors');
const { checkDbConnection } = require('./supabaseClient');
const billingRoutes = require('./routes/billing');
const saasRoutes = require('./routes/saas');
const storageRoutes = require('./routes/storage');
const contactRoutes = require('./routes/contact');

const app = express();
const PORT = process.env.PORT || 3000;
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true); return callback(new Error('Origen no autorizado por CORS')); }, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Signature'] }));

// Webhooks must receive their raw/form body before the global JSON parser.
app.use('/api', billingRoutes);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => res.json({ status: 'ok', app: 'T-Show API', timestamp: new Date().toISOString(), env: process.env.NODE_ENV || 'development', db: await checkDbConnection() ? 'ok' : 'unreachable' }));
app.get('/api/config', (_req, res) => res.json({ supabaseUrl: process.env.SUPABASE_URL || null, supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null }));
app.use('/api', saasRoutes);
app.use('/api', contactRoutes);
app.use('/api', storageRoutes);
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ success: false, message: 'Error interno.' }); });
app.listen(PORT, () => console.log(`T-Show API listening on ${PORT}`));
