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

    zone(config = {}) { return config.timeZone || config.timezone || 'America/Santiago'; },

    dateInZone(now, zone) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date(now));
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
    },

    zonedTime(date, time, zone) {
        const [year, month, day] = String(date).split('-').map(Number);
        const value = String(time || '00:00');
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('El horario debe usar el formato HH:MM.');
        const [hours, minutes] = value.split(':').map(Number);
        const target = Date.UTC(year, month - 1, day, hours, minutes);
        const formatter = new Intl.DateTimeFormat('en-GB', { timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' });
        let epoch = target;
        for (let attempt = 0; attempt < 4; attempt++) {
            const values = Object.fromEntries(formatter.formatToParts(epoch).map(part => [part.type, part.value]));
            const actual = Date.UTC(+values.year, +values.month - 1, +values.day, +values.hour, +values.minute, +values.second);
            if (actual === target) return epoch;
            epoch += target - actual;
        }
        throw new Error('El horario no existe en la zona horaria seleccionada.');
    },

    formatTimeInZone(date, zone) {
        return new Intl.DateTimeFormat('es-CL', { timeZone:zone, hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(new Date(date));
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

        const zone = this.zone(config);
        const baseDate = config.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(config.eventDate)
            ? config.eventDate : this.dateInZone(Date.now(), zone);
        const dateAt = (date, time) => new Date(this.zonedTime(date, time, zone));
        const timeValue = time => { const [hours, minutes] = String(time || '00:00').split(':').map(Number); return hours * 60 + minutes; };
        const dateAfter = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

        // 1. Convocatoria
        const convDate = dateAt(baseDate, convocatoriaTime);
        const convDurationMin = Math.max(0, parseInt(convocatoriaDuration) || 0);
        const convEndDate = this.addMinutes(convDate, convDurationMin);

        // 2. Apertura Puertas
        const doorsBaseDate = timeValue(doorsTime) < timeValue(convocatoriaTime) ? dateAfter(baseDate, 1) : baseDate;
        let doorsDate = dateAt(doorsBaseDate, doorsTime);
        const doorsDurationMin = Math.max(0, parseInt(doorsDuration) || 0);
        const doorsEndDate = this.addMinutes(doorsDate, doorsDurationMin);

        // 3. Show Start
        let showStartDate;
        if (showStartMode === 'auto') {
            showStartDate = new Date(doorsEndDate);
        } else {
            const showBaseDate = timeValue(showStartTimeInput) < timeValue(doorsTime) ? dateAfter(doorsBaseDate, 1) : doorsBaseDate;
            showStartDate = dateAt(showBaseDate, showStartTimeInput);
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
                start: this.formatTimeInZone(convDate, zone), startAt: new Date(convDate).toISOString(),
                duration: convDurationMin,
                end: this.formatTimeInZone(convEndDate, zone), endAt: new Date(convEndDate).toISOString(),
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
                start: this.formatTimeInZone(doorsDate, zone), startAt: new Date(doorsDate).toISOString(),
                duration: doorsDurationMin,
                end: this.formatTimeInZone(doorsEndDate, zone), endAt: new Date(doorsEndDate).toISOString(),
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
                    blockId: block.id,
                    raw: block,
                    num: itemIndex++,
                    type: block.type,
                    badgeClass: badgeClass,
                    title: block.title || 'Bloque sin título',
                    start: this.formatTimeInZone(currentTime, zone), startAt: new Date(currentTime).toISOString(),
                    duration: blockDuration,
                    end: this.formatTimeInZone(endTime, zone), endAt: new Date(endTime).toISOString(),
                    color: color
                });
                currentTime = endTime;
            }

            // Encore / Bis for SHOW type
            if (block.type === 'SHOW' && blockBis > 0) {
                const endTime = this.addMinutes(currentTime, blockBis);
                tableRows.push({
                    blockId: block.id ? block.id + ':encore' : undefined,
                    raw: block,
                    num: itemIndex++,
                    type: 'BIS / ENCORE',
                    badgeClass: 'badge-bis',
                    title: `${block.title || 'Artista'} - Bis / Cierre`,
                    start: this.formatTimeInZone(currentTime, zone), startAt: new Date(currentTime).toISOString(),
                    duration: blockBis,
                    end: this.formatTimeInZone(endTime, zone), endAt: new Date(endTime).toISOString(),
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
                convocatoriaTimeFormatted: this.formatTimeInZone(convDate, zone),
                doorsTimeFormatted: this.formatTimeInZone(doorsDate, zone),
                showStartTimeFormatted: this.formatTimeInZone(showStartDate, zone),
                endTimeFormatted: this.formatTimeInZone(currentTime, zone),
                totalDurationFormatted: this.formatDuration(totalDurationMinutes)
            }, zone, eventDate: baseDate
        };
    }
};

// Export for module/browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimingEngine;
}
