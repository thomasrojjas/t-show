const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'projects.json');

// Helper to ensure data directory and file exist
function readProjects() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            const dataDir = path.dirname(DATA_FILE);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2), 'utf8');
            return {};
        }
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data || '{}');
    } catch (err) {
        console.error('Error leyendo projects.json:', err);
        return {};
    }
}

function writeProjects(projects) {
    try {
        const dataDir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(projects, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('Error guardando projects.json:', err);
        return false;
    }
}

// Controller handlers
function getProjects(req, res) {
    const projects = readProjects();
    res.json({ success: true, count: Object.keys(projects).length, data: projects });
}

function getProjectByName(req, res) {
    const { name } = req.params;
    const projects = readProjects();
    if (projects[name]) {
        res.json({ success: true, data: projects[name] });
    } else {
        res.status(404).json({ success: false, message: `Proyecto "${name}" no encontrado` });
    }
}

function saveProject(req, res) {
    const projectData = req.body;
    if (!projectData || !projectData.eventName) {
        return res.status(400).json({ success: false, message: 'El nombre del evento es requerido' });
    }

    const projects = readProjects();
    const eventName = projectData.eventName.trim();

    projectData.updatedAt = new Date().toISOString();
    if (!projectData.savedAt) {
        projectData.savedAt = projectData.updatedAt;
    }

    projects[eventName] = projectData;
    const ok = writeProjects(projects);

    if (ok) {
        res.json({ success: true, message: `Proyecto "${eventName}" guardado exitosamente`, data: projectData });
    } else {
        res.status(500).json({ success: false, message: 'Error al persistir el proyecto en disco' });
    }
}

function deleteProject(req, res) {
    const { name } = req.params;
    const projects = readProjects();

    if (projects[name]) {
        delete projects[name];
        writeProjects(projects);
        res.json({ success: true, message: `Proyecto "${name}" eliminado correctamente` });
    } else {
        res.status(404).json({ success: false, message: `Proyecto "${name}" no encontrado` });
    }
}

function exportProjects(req, res) {
    const projects = readProjects();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="eventtime-projects-export.json"');
    res.send(JSON.stringify(projects, null, 2));
}

module.exports = {
    readProjects,
    writeProjects,
    getProjects,
    getProjectByName,
    saveProject,
    deleteProject,
    exportProjects
};
