const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const LIVE_DATA_FILE = path.join(DATA_DIR, 'live_sessions.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Middleware
app.use(cors({
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// Health Check for Render zero-downtime deploys
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        app: 'Show Time Backend API',
        developedBy: 'BaseAndes Software (https://www.baseandes.com/)',
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV || 'development'
    });
});

// Helper functions for file storage
function readJsonFile(filePath, defaultValue = {}) {
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
            return defaultValue;
        }
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data || '{}');
    } catch (err) {
        console.error(`Error reading ${filePath}:`, err);
        return defaultValue;
    }
}

function writeJsonFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error(`Error writing ${filePath}:`, err);
        return false;
    }
}

// --- PROJECTS API ---

app.get('/api/projects', (req, res) => {
    const projects = readJsonFile(PROJECTS_FILE, {});
    res.json({ success: true, count: Object.keys(projects).length, data: projects });
});

app.get('/api/projects/:name', (req, res) => {
    const { name } = req.params;
    const projects = readJsonFile(PROJECTS_FILE, {});
    if (projects[name]) {
        res.json({ success: true, data: projects[name] });
    } else {
        res.status(404).json({ success: false, message: `Proyecto "${name}" no encontrado` });
    }
});

app.post('/api/projects', (req, res) => {
    const projectData = req.body;
    if (!projectData || !projectData.eventName) {
        return res.status(400).json({ success: false, message: 'El nombre del evento es requerido' });
    }

    const projects = readJsonFile(PROJECTS_FILE, {});
    const eventName = projectData.eventName.trim();

    projectData.updatedAt = new Date().toISOString();
    if (!projectData.savedAt) {
        projectData.savedAt = projectData.updatedAt;
    }

    projects[eventName] = projectData;
    const ok = writeJsonFile(PROJECTS_FILE, projects);

    if (ok) {
        res.json({ success: true, message: `Proyecto "${eventName}" guardado exitosamente`, data: projectData });
    } else {
        res.status(500).json({ success: false, message: 'Error al persistir el proyecto en disco' });
    }
});

app.delete('/api/projects/:name', (req, res) => {
    const { name } = req.params;
    const projects = readJsonFile(PROJECTS_FILE, {});

    if (projects[name]) {
        delete projects[name];
        writeJsonFile(PROJECTS_FILE, projects);
        res.json({ success: true, message: `Proyecto "${name}" eliminado correctamente` });
    } else {
        res.status(404).json({ success: false, message: `Proyecto "${name}" no encontrado` });
    }
});

// --- LIVE STAGE API ---

app.get('/api/live', (req, res) => {
    const queryProj = req.query.project;
    const sessions = readJsonFile(LIVE_DATA_FILE, {});

    if (queryProj) {
        res.json({ success: true, data: sessions[queryProj] || null });
    } else {
        res.json({ success: true, data: sessions });
    }
});

app.post('/api/live', (req, res) => {
    const livePayload = req.body;
    if (!livePayload || !livePayload.projectName) {
        return res.status(400).json({ success: false, message: 'Falta projectName en la sesión en vivo' });
    }

    const sessions = readJsonFile(LIVE_DATA_FILE, {});
    livePayload.lastUpdated = new Date().toISOString();
    sessions[livePayload.projectName] = livePayload;

    writeJsonFile(LIVE_DATA_FILE, sessions);
    res.json({ success: true, message: 'Estado en vivo actualizado', data: livePayload });
});

// Serve frontend if running fullstack locally
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(FRONTEND_DIR)) {
    app.use(express.static(FRONTEND_DIR));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
    });
}

// Start Server
app.listen(PORT, () => {
    console.log('====================================================');
    console.log(`   ⏱ Show Time API - BaseAndes Software`);
    console.log(`   📡 Puerto: ${PORT}`);
    console.log(`   🌍 CORS Origin: ${CORS_ORIGIN}`);
    console.log(`   🔌 Health: http://localhost:${PORT}/api/health`);
    console.log('====================================================');
});
