/**
 * TimingEngine
 * Core mathematical engine for calculating live event schedules and time durations
 */
const TimingEngine = {
    /**
     * Format a Date object to "HH:MM" 24h string
     */
    formatTime(date) {
        if (!date) return '00:00';
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    },

    /**
     * Parse "HH:MM" string to a base Date object
     */
    parseTimeString(timeStr, baseDate = new Date()) {
        const [hours, minutes] = (timeStr || '00:00').split(':').map(Number);
        const d = new Date(baseDate);
        d.setHours(hours || 0, minutes || 0, 0, 0);
        return d;
    },

    /**
     * Add minutes to a Date object, returning a new Date
     */
    addMinutes(date, minutes) {
        return new Date(date.getTime() + (parseInt(minutes) || 0) * 60000);
    },

    /**
     * Calculate difference in minutes between two dates
     */
    diffMinutes(startDate, endDate) {
        return Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    },

    /**
     * Format total minutes into "Xh Ym" or "Xm"
     */
    formatDuration(totalMinutes) {
        const m = Math.max(0, parseInt(totalMinutes) || 0);
        const hours = Math.floor(m / 60);
        const remainingMin = m % 60;
        if (hours === 0) return `${remainingMin}m`;
        return `${hours}h ${remainingMin}m`;
    },

    /**
     * Calculate entire event schedule
     * @param {Object} config - Event configuration
     * @param {Array} blocks - Array of block items
     * @returns {Object} Calculated schedule details
     */
    computeSchedule(config, blocks) {
        const {
            convocatoriaTime = '18:30',
            convocatoriaDuration = 30,
            doorsTime = '19:30',
            doorsDuration = 60,
            showStartMode = 'auto',
            showStartTimeInput = '20:30'
        } = config;

        // Base date
        const baseDate = new Date();

        // 1. Convocatoria
        const convDate = this.parseTimeString(convocatoriaTime, baseDate);
        const convDurationMin = Math.max(0, parseInt(convocatoriaDuration) || 0);
        const convEndDate = this.addMinutes(convDate, convDurationMin);

        // 2. Apertura Puertas
        let doorsDate = this.parseTimeString(doorsTime, baseDate);
        // Handle if doors start before convocatoria time on crossing midnight
        if (doorsDate < convDate && (convDate.getHours() > 12 && doorsDate.getHours() < 12)) {
            doorsDate.setDate(doorsDate.getDate() + 1);
        }
        const doorsDurationMin = Math.max(0, parseInt(doorsDuration) || 0);
        const doorsEndDate = this.addMinutes(doorsDate, doorsDurationMin);

        // 3. Show Start
        let showStartDate;
        if (showStartMode === 'auto') {
            showStartDate = new Date(doorsEndDate);
        } else {
            showStartDate = this.parseTimeString(showStartTimeInput, baseDate);
            if (showStartDate < doorsDate && (doorsDate.getHours() > 12 && showStartDate.getHours() < 12)) {
                showStartDate.setDate(showStartDate.getDate() + 1);
            }
        }

        // Build Table Rows and Timeline
        const tableRows = [];
        let itemIndex = 1;

        // Convocatoria row
        if (convDurationMin > 0) {
            tableRows.push({
                num: itemIndex++,
                type: 'CONVOCATORIA',
                badgeClass: 'badge-conv',
                title: 'Convocatoria de Comisiones & Briefing de Producción',
                start: this.formatTime(convDate),
                duration: convDurationMin,
                end: this.formatTime(convEndDate),
                color: '#c084fc'
            });
        }

        // Doors row
        if (doorsDurationMin > 0) {
            tableRows.push({
                num: itemIndex++,
                type: 'PUERTAS',
                badgeClass: 'badge-doors',
                title: 'Apertura de Puertas / DJ Ambientación',
                start: this.formatTime(doorsDate),
                duration: doorsDurationMin,
                end: this.formatTime(doorsEndDate),
                color: '#06b6d4'
            });
        }

        // Blocks calculation
        let currentTime = new Date(showStartDate);

        blocks.forEach((block) => {
            const blockDuration = Math.max(0, parseInt(block.duration) || 0);
            const blockBis = Math.max(0, parseInt(block.bis) || 0);

            if (blockDuration > 0) {
                const endTime = this.addMinutes(currentTime, blockDuration);
                let badgeClass = 'badge-show';
                let color = '#6366f1';

                if (block.type === 'PREPARACIÓN') {
                    badgeClass = 'badge-prep';
                    color = '#22d3ee';
                } else if (block.type === 'ANIMACIÓN') {
                    badgeClass = 'badge-anim';
                    color = '#10b981';
                } else if (block.type === 'OTRO') {
                    badgeClass = 'badge-other';
                    color = '#94a3b8';
                }

                tableRows.push({
                    num: itemIndex++,
                    type: block.type,
                    badgeClass: badgeClass,
                    title: block.title || 'Bloque sin título',
                    start: this.formatTime(currentTime),
                    duration: blockDuration,
                    end: this.formatTime(endTime),
                    color: color
                });
                currentTime = endTime;
            }

            // Encore / Bis for SHOW type
            if (block.type === 'SHOW' && blockBis > 0) {
                const endTime = this.addMinutes(currentTime, blockBis);
                tableRows.push({
                    num: itemIndex++,
                    type: 'BIS / ENCORE',
                    badgeClass: 'badge-bis',
                    title: `${block.title || 'Artista'} - Bis / Cierre`,
                    start: this.formatTime(currentTime),
                    duration: blockBis,
                    end: this.formatTime(endTime),
                    color: '#f59e0b'
                });
                currentTime = endTime;
            }
        });

        // Total Span
        const totalDurationMinutes = this.diffMinutes(convDate, currentTime);

        return {
            convDate,
            convEndDate,
            doorsDate,
            doorsEndDate,
            showStartDate,
            endDate: currentTime,
            totalDurationMinutes: Math.max(0, totalDurationMinutes),
            tableRows,
            metrics: {
                convocatoriaTimeFormatted: this.formatTime(convDate),
                doorsTimeFormatted: this.formatTime(doorsDate),
                showStartTimeFormatted: this.formatTime(showStartDate),
                endTimeFormatted: this.formatTime(currentTime),
                totalDurationFormatted: this.formatDuration(totalDurationMinutes)
            }
        };
    }
};

// Export for module/browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimingEngine;
}
