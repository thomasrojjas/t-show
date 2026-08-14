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
        const currentIndex = Math.max(0, liveState.currentIndex || 0);

        let currentItem = null;
        let elapsedSeconds = 0;
        let remainingSeconds = 0;
        let progressPercent = 0;
        let isOvertime = false;
        let overtimeSeconds = 0;

        if (status === 'live' && activeItems.length > 0 && currentIndex < activeItems.length) {
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
        }

        // Project remaining future blocks starting from now + remainingSeconds
        let projectedCurrentTime = new Date();
        if (status === 'live') {
            const remainingCurrentBlockSec = Math.max(0, remainingSeconds);
            projectedCurrentTime = new Date(now.getTime() + remainingCurrentBlockSec * 1000);
        }

        const enrichedItems = activeItems.map((item, idx) => {
            let rowState = 'future'; // 'completed' | 'active' | 'future'
            let liveStart = item.start;
            let liveEnd = item.end;
            let rowProgress = 0;

            if (idx < currentIndex) {
                rowState = 'completed';
                // Check if we have recorded history
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
            } else if (remainingSeconds <= 30) {
                alertLevel = 'red';
            } else if (remainingSeconds <= 60) {
                alertLevel = 'yellow';
            }
        }

        return {
            status,
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
            projectedEndTime: status === 'live' ? TimingEngine.formatTime(projectedCurrentTime) : baseComputed.metrics.endTimeFormatted
        };
    }
};

// Export for module/browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LiveEngine;
}
