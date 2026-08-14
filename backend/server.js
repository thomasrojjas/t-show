const http = require('http');
const fs = require('fs');
const path = require('path');
const projectsRoute = require('./routes/projects');

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

// MIME types for static frontend serving
const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.js': 'application/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// Try importing Express if installed, otherwise run native HTTP server
let expressApp = null;
try {
    const express = require('express');
    const cors = require('cors');

    const app = express();
    app.use(cors());
    app.use(express.json());

    // API Routes
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', time: new Date().toISOString(), server: 'Express REST API' });
    });

    app.get('/api/projects', projectsRoute.getProjects);
    app.get('/api/projects/export', projectsRoute.exportProjects);
    app.get('/api/projects/:name', projectsRoute.getProjectByName);
    app.post('/api/projects', projectsRoute.saveProject);
    app.delete('/api/projects/:name', projectsRoute.deleteProject);

    // Live Session endpoints
    const LIVE_DATA_FILE = path.join(__dirname, 'data', 'live_sessions.json');
    app.get('/api/live', (req, res) => {
        const queryProj = req.query.project;
        let sessions = {};
        try {
            if (fs.existsSync(LIVE_DATA_FILE)) {
                sessions = JSON.parse(fs.readFileSync(LIVE_DATA_FILE, 'utf8') || '{}');
            }
        } catch (e) {}
        if (queryProj) {
            res.json({ success: true, data: sessions[queryProj] || null });
        } else {
            res.json({ success: true, data: sessions });
        }
    });

    app.post('/api/live', (req, res) => {
        const payload = req.body;
        if (!payload || !payload.projectName) {
            return res.status(400).json({ success: false, message: 'projectName requerido' });
        }
        let sessions = {};
        try {
            if (fs.existsSync(LIVE_DATA_FILE)) {
                sessions = JSON.parse(fs.readFileSync(LIVE_DATA_FILE, 'utf8') || '{}');
            }
        } catch (e) {}
        sessions[payload.projectName] = payload;
        try {
            fs.writeFileSync(LIVE_DATA_FILE, JSON.stringify(sessions, null, 2), 'utf8');
        } catch (e) {}
        res.json({ success: true, message: 'Estado en vivo actualizado' });
    });

    // Static Frontend files
    app.use(express.static(FRONTEND_DIR));

    // Fallback for SPA routing
    app.get('*', (req, res) => {
        const indexPath = path.join(FRONTEND_DIR, 'index.html');
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            res.status(404).send('Frontend index.html no encontrado');
        }
    });

    expressApp = app;
} catch (e) {
    // Express not installed yet, will use native HTTP server below
}

// Native Node.js HTTP Server fallback handler
function handleNativeRequest(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    // API Routing
    if (pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');

        if (pathname === '/api/health' && req.method === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString(), server: 'Native Node.js Server' }));
            return;
        }

        if (pathname === '/api/projects/export' && req.method === 'GET') {
            const projects = projectsRoute.readProjects();
            res.setHeader('Content-Disposition', 'attachment; filename="eventtime-projects-export.json"');
            res.writeHead(200);
            res.end(JSON.stringify(projects, null, 2));
            return;
        }

        if (pathname === '/api/projects' && req.method === 'GET') {
            const projects = projectsRoute.readProjects();
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, count: Object.keys(projects).length, data: projects }));
            return;
        }

        if (pathname === '/api/projects' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const projectData = JSON.parse(body || '{}');
                    if (!projectData || !projectData.eventName) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, message: 'El nombre del evento es requerido' }));
                        return;
                    }
                    const projects = projectsRoute.readProjects();
                    const eventName = projectData.eventName.trim();
                    projectData.updatedAt = new Date().toISOString();
                    if (!projectData.savedAt) projectData.savedAt = projectData.updatedAt;

                    projects[eventName] = projectData;
                    projectsRoute.writeProjects(projects);

                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, message: `Proyecto "${eventName}" guardado exitosamente`, data: projectData }));
                } catch (err) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, message: 'JSON inválido' }));
                }
            });
            return;
        }

        if (pathname.startsWith('/api/projects/')) {
            const projectName = pathname.replace('/api/projects/', '');
            if (req.method === 'GET') {
                const projects = projectsRoute.readProjects();
                if (projects[projectName]) {
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: projects[projectName] }));
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ success: false, message: `Proyecto "${projectName}" no encontrado` }));
                }
                return;
            }

            if (req.method === 'DELETE') {
                const projects = projectsRoute.readProjects();
                if (projects[projectName]) {
                    delete projects[projectName];
                    projectsRoute.writeProjects(projects);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, message: `Proyecto "${projectName}" eliminado` }));
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ success: false, message: `Proyecto "${projectName}" no encontrado` }));
                }
                return;
            }
        }

        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: 'Endpoint no encontrado' }));
        return;
    }

    // Static files routing
    let relativeFilePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    let filePath = path.join(FRONTEND_DIR, relativeFilePath);

    // If file doesn't exist, fallback to index.html
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(FRONTEND_DIR, 'index.html');
    }

    if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=UTF-8' });
                res.end('Error interno del servidor');
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('404 - Archivo no encontrado');
    }
}

// Start Server
const server = expressApp ? expressApp : http.createServer(handleNativeRequest);

server.listen(PORT, () => {
    console.log('====================================================');
    console.log(`⏱  EventTime Pro v4.0 - Servidor en Ejecución`);
    console.log(`📡 URL Principal: http://localhost:${PORT}`);
    console.log(`🔌 API REST:      http://localhost:${PORT}/api/projects`);
    console.log(`📂 Servidor:      ${expressApp ? 'Express Framework' : 'Node.js Nativo'}`);
    console.log('====================================================');
});
