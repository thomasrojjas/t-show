/* Team management is mounted by the authenticated workspace shell. */
window.TeamManager = window.TeamManager || { load: () => window.WorkspaceShell?.navigate('team', true), invite: () => window.WorkspaceShell?.navigate('team', true) };
