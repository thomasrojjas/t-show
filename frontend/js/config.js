/**
 * Show Time - Runtime Configuration
 * Developed by BaseAndes Software (https://www.baseandes.com/)
 * 
 * This file sets the API backend URL based on the deployment environment.
 * - In production (Vercel): points directly to the Render backend
 * - In local development: uses the same origin (localhost:3000)
 */
(function () {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

    if (!isLocalhost) {
        // Production: point directly to Render backend
        window.SHOWTIME_API_URL = 'https://timming-3bdp.onrender.com';
    }
    // If localhost, SHOWTIME_API_URL remains undefined and api-client.js uses window.location.origin
})();
