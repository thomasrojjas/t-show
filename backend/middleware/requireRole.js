const { supabase } = require('../supabaseClient');

/** Exige que req.user.role (rol global, del JWT) esté en la lista permitida. */
function requireGlobalRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'No tienes permiso para esta acción' });
        }
        next();
    };
}

const PROJECT_ROLE_RANK = { viewer: 1, editor: 2, director: 3 };

/**
 * Exige un rol mínimo SOBRE UN PROYECTO ESPECÍFICO, consultando la base de datos
 * (nunca confía en un rol enviado por el cliente en el body/query).
 * Requiere que la ruta tenga :projectId (o :id) en los params.
 * superadmin siempre pasa. El owner_id del proyecto siempre cuenta como 'director'.
 */
function requireProjectRole(minRole) {
    const minRank = PROJECT_ROLE_RANK[minRole];
    return async (req, res, next) => {
        if (!req.user) return res.status(401).json({ success: false, message: 'No autenticado' });
        if (req.user.role === 'superadmin') return next();

        const projectId = req.params.projectId || req.params.id;
        if (!projectId) return res.status(400).json({ success: false, message: 'Falta el identificador del proyecto' });

        const { data: project, error: projectErr } = await supabase
            .from('projects')
            .select('id, owner_id')
            .eq('id', projectId)
            .single();

        if (projectErr || !project) {
            return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
        }

        if (project.owner_id === req.user.id) {
            req.projectRole = 'director';
            return next();
        }

        const { data: membership, error: memberErr } = await supabase
            .from('project_members')
            .select('role')
            .eq('project_id', projectId)
            .eq('user_id', req.user.id)
            .maybeSingle();

        if (memberErr || !membership) {
            return res.status(403).json({ success: false, message: 'No tienes acceso a este proyecto' });
        }

        if (PROJECT_ROLE_RANK[membership.role] < minRank) {
            return res.status(403).json({ success: false, message: 'Tu rol en este proyecto no permite esta acción' });
        }

        req.projectRole = membership.role;
        next();
    };
}

module.exports = { requireGlobalRole, requireProjectRole };
