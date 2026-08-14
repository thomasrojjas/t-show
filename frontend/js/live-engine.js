/**
 * LiveEngine
 * Core real-time math engine for live show tracking, progressive timing and cascading projection
 */
const LiveEngine = {
    /**
     * Format a Date object to "HH:MM:SS" string
     */
    formatTimeSeconds(date) {
        if (!date) return '00:00:00';
        const d = new Date(date);
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        const s = String(d.getSeconds()).padStart(2, '0');
        return `${h}:${m}:${s}`;
    },

    /**
     * Format seconds into "MM:SS" or "HH:MM:SS"
     */
    formatDurationSeconds(totalSeconds) {
        const isNegative = totalSeconds < 0;
        const absSec = Math.abs(Math.floor(totalSeconds));
        const hours = Math.floor(absSec / 3600);
        const minutes = Math.floor((absSec % 3600) / 60);
        const seconds = absSec % 60;

        const pad = (num) => String(num).padStart(2, '0');

        let formatted = '';
        if (hours > 0) {
            formatted = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
        } else {
            formatted = `${pad(minutes)}:${pad(seconds)}`;
        }

        return isNegative ? `-${formatted}` : formatted;
    },

    /**
     * Compute full live state snapshot
     * @param {Object} projectData - The base project configuration
     * @param {Object} liveState - The current live session state
     * @returns {Object} Complete calculated live model
     */
    computeLiveSnapshot(projectData, liveState) {
        if (!projectData) return null;

        // Base plan computation
        const baseComputed = TimingEngine.computeSchedule(projectData, projectData.blocks || []);
        const now = new Date();

        // Extract list of all printable schedule items from base plan
        const allItems = JSON.parse(JSON.stringify(baseComputed.tableRows || []));

        // Filter out omitted blocks
        const activeItems = allItems.filter(item => {
            const isOmitted = liveState.omittedItemNums && liveState.omittedItemNums.includes(item.num);
            return !isOmitted;
        });

        const status = liveState.status || 'idle'; // 'idle' | 'live' | 'paused' | 'finished'
        const trackingMode = liveState.trackingMode || 'schedule'; // 'schedule' | 'manual'
        let currentIndex = Math.max(0, liveState.currentIndex || 0);

        let currentItem = null;
        let elapsedSeconds = 0;
        let remainingSeconds = 0;
        let progressPercent = 0;
        let isOvertime = false;
        let overtimeSeconds = 0;

        // Helper to convert "HH:MM" to Date for today
        const getRowDateTime = (timeStr, baseD = now, isNextDay = false) => {
            const [h, m] = (timeStr || '00:00').split(':').map(Number);
            const d = new Date(baseD);
            d.setHours(h || 0, m || 0, 0, 0);
            if (isNextDay) d.setDate(d.getDate() + 1);
            return d;
        };

        // Attach absolute timestamps to items
        let prevEndHour = -1;
        let dayOffset = 0;
        const mappedScheduleItems = activeItems.map((item, idx) => {
            const startHour = parseInt((item.start || '00:00').split(':')[0]) || 0;
            if (prevEndHour > 18 && startHour < 6) {
                dayOffset = 1; // crossed midnight
            }
            const startDate = getRowDateTime(item.start, now, dayOffset > 0);
            const endDate = new Date(startDate.getTime() + (item.duration * 60000));
            prevEndHour = endDate.getHours();
            return {
                ...item,
                startDate,
                endDate
            };
        });

        // 1. AUTO SCHEDULE TRACKING MODE (Seguimiento según Horario Programado)
        if (status === 'live' && trackingMode === 'schedule' && mappedScheduleItems.length > 0) {
            // Find which item corresponds to current clock time
            let foundIdx = -1;
            for (let i = 0; i < mappedScheduleItems.length; i++) {
                const item = mappedScheduleItems[i];
                if (now >= item.startDate && now < item.endDate) {
                    foundIdx = i;
                    break;
                }
            }

            // If time is before first item
            if (foundIdx === -1 && now < mappedScheduleItems[0].startDate) {
                currentIndex = 0;
                currentItem = mappedScheduleItems[0];
                const diffToStartSec = Math.max(0, Math.floor((mappedScheduleItems[0].startDate.getTime() - now.getTime()) / 1000));
                elapsedSeconds = 0;
                remainingSeconds = diffToStartSec;
                progressPercent = 0;
            } 
            // If time is after last item
            else if (foundIdx === -1 && now >= mappedScheduleItems[mappedScheduleItems.length - 1].endDate) {
                currentIndex = mappedScheduleItems.length - 1;
                currentItem = mappedScheduleItems[currentIndex];
                elapsedSeconds = (currentItem.duration || 1) * 60;
                remainingSeconds = 0;
                progressPercent = 100;
            } 
            // Currently within a scheduled item or gap
            else {
                if (foundIdx !== -1) {
                    currentIndex = foundIdx;
                    currentItem = mappedScheduleItems[currentIndex];
                    const totalDurSec = (currentItem.duration || 1) * 60;
                    elapsedSeconds = Math.max(0, Math.floor((now.getTime() - currentItem.startDate.getTime()) / 1000));
                    remainingSeconds = Math.max(0, Math.floor((currentItem.endDate.getTime() - now.getTime()) / 1000));
                    progressPercent = Math.min(100, Math.max(0, (elapsedSeconds / totalDurSec) * 100));
                } else {
                    // In a gap between items: pick next upcoming item
                    for (let i = 0; i < mappedScheduleItems.length; i++) {
                        if (now < mappedScheduleItems[i].startDate) {
                            currentIndex = i;
                            currentItem = mappedScheduleItems[i];
                            elapsedSeconds = 0;
                            remainingSeconds = Math.max(0, Math.floor((currentItem.startDate.getTime() - now.getTime()) / 1000));
                            progressPercent = 0;
                            break;
                        }
                    }
                }
            }
        } 
        // 2. MANUAL DIRECTOR TRACKING MODE (Control por Director con TAP)
        else if (status === 'live' && trackingMode === 'manual' && activeItems.length > 0 && currentIndex < activeItems.length) {
            currentItem = activeItems[currentIndex];
            const blockStartMs = liveState.currentBlockStartTime ? new Date(liveState.currentBlockStartTime).getTime() : now.getTime();
            const totalDurationSec = (currentItem.duration || 1) * 60;

            elapsedSeconds = Math.max(0, Math.floor((now.getTime() - blockStartMs) / 1000));
            remainingSeconds = totalDurationSec - elapsedSeconds;

            if (remainingSeconds < 0) {
                isOvertime = true;
                overtimeSeconds = Math.abs(remainingSeconds);
                progressPercent = 100;
            } else {
                progressPercent = Math.min(100, Math.max(0, (elapsedSeconds / totalDurationSec) * 100));
            }
        } else if (activeItems.length > 0) {
            // Idle / Paused
            currentItem = activeItems[currentIndex] || activeItems[0];
            remainingSeconds = (currentItem ? currentItem.duration : 0) * 60;
        }

        // Project remaining future blocks
        let projectedCurrentTime = new Date();
        if (status === 'live' && trackingMode === 'manual') {
            const remainingCurrentBlockSec = Math.max(0, remainingSeconds);
            projectedCurrentTime = new Date(now.getTime() + remainingCurrentBlockSec * 1000);
        }

        const enrichedItems = activeItems.map((item, idx) => {
            let rowState = 'future'; // 'completed' | 'active' | 'future'
            let liveStart = item.start;
            let liveEnd = item.end;
            let rowProgress = 0;

            if (trackingMode === 'schedule') {
                const schedItem = mappedScheduleItems[idx];
                if (schedItem) {
                    if (now >= schedItem.endDate) {
                        rowState = 'completed';
                        rowProgress = 100;
                    } else if (now >= schedItem.startDate && now < schedItem.endDate && status === 'live') {
                        rowState = 'active';
                        rowProgress = progressPercent;
                    } else {
                        rowState = 'future';
                        rowProgress = 0;
                    }
                }
            } else {
                // Manual mode
                if (idx < currentIndex) {
                    rowState = 'completed';
                    const hist = (liveState.history || []).find(h => h.num === item.num);
                    if (hist) {
                        liveStart = hist.actualStartFormatted || item.start;
                        liveEnd = hist.actualEndFormatted || item.end;
                    }
                    rowProgress = 100;
                } else if (idx === currentIndex && status === 'live') {
                    rowState = 'active';
                    const blockStart = liveState.currentBlockStartTime ? new Date(liveState.currentBlockStartTime) : now;
                    liveStart = TimingEngine.formatTime(blockStart);
                    const projectedBlockEnd = new Date(blockStart.getTime() + (item.duration * 60000));
                    liveEnd = TimingEngine.formatTime(projectedBlockEnd);
                    rowProgress = progressPercent;
                } else if (status === 'live' && idx > currentIndex) {
                    rowState = 'future';
                    liveStart = TimingEngine.formatTime(projectedCurrentTime);
                    projectedCurrentTime = TimingEngine.addMinutes(projectedCurrentTime, item.duration);
                    liveEnd = TimingEngine.formatTime(projectedCurrentTime);
                }
            }

            return {
                ...item,
                rowState,
                liveStart,
                liveEnd,
                rowProgress
            };
        });

        // Determine Alert Level for screen perimeter border
        let alertLevel = 'normal'; // 'normal' | 'yellow' | 'red' | 'overtime'
        if (status === 'live' && currentItem) {
            if (isOvertime) {
                alertLevel = 'overtime';
            } else if (remainingSeconds <= 30 && remainingSeconds > 0) {
                alertLevel = 'red';
            } else if (remainingSeconds <= 60 && remainingSeconds > 0) {
                alertLevel = 'yellow';
            }
        }

        return {
            status,
            trackingMode,
            currentIndex,
            currentItem,
            elapsedSeconds,
            remainingSeconds,
            progressPercent,
            isOvertime,
            overtimeSeconds,
            alertLevel,
            items: enrichedItems,
            history: liveState.history || [],
            projectedEndTime: (status === 'live' && trackingMode === 'manual') ? TimingEngine.formatTime(projectedCurrentTime) : baseComputed.metrics.endTimeFormatted
        };
    }
};

// Export for module/browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LiveEngine;
}
