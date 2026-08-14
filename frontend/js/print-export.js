/**
 * Print & Export Manager
 * Handles Toast notifications, printing, JSON export/import
 */
const PrintExportManager = {
    /**
     * Show animated Toast Notification
     */
    showToast(message, type = 'success', duration = 3500) {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        let icon = '✔';
        if (type === 'danger') icon = '✕';
        if (type === 'info') icon = 'ℹ';

        toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    /**
     * Export all projects or current project as a JSON backup file
     */
    exportJSON(currentProjectData) {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentProjectData, null, 2));
        const downloadAnchor = document.createElement('a');
        const filename = `timing-${(currentProjectData.eventName || 'proyecto').toLowerCase().replace(/\s+/g, '-')}.json`;
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", filename);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        this.showToast(`Archivo ${filename} descargado exitosamente`, 'success');
    },

    /**
     * Trigger browser print dialog
     */
    triggerPrint() {
        window.print();
    }
};
