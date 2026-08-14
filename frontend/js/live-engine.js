/**
 * LiveEngine
 * Core real-time math engine for live show tracking, progressive timing, block extension, and cascading projection
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
     * Format seconds into "MM:SS" or "HH:MM:SS" with explicit seconds
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

        // Extract list of all schedule items from base plan
        const allItems = JSON.parse(JSON.stringify(baseComputed.tableRows || []));

        const omittedList = liveState.omittedItemNums || [];
        const mutedList = liveState.mutedBlockNums || [];
        const extensions = liveState.blockExtensions || {};

        // Identify muted, omitted and extended items
        const processedItems = allItems.map(item => {
            const isOmitted = omittedList.includes(item.num);
            const isMuted = mutedList.includes(item.num);
            const addedMinutes = extensions[item.num] || 0;
            const effectiveDuration = isMuted ? 0 : Math.max(1, item.duration + addedMinutes);

            return {
                ...item,
                isOmitted,
                isMuted,
                addedMinutes,
                duration: effectiveDuration,
                originalDuration: item.duration,
                effectiveDuration
            };
        }).filter(item => !item.isOmitted);

        const status = liveState.status || 'idle'; // 'idle' | 'live' | 'paused' | 'finished'
        const trackingMode = liveState.trackingMode || 'schedule'; // 'schedule' | 'manual'
        let currentIndex = Math.max(0, liveState.currentIndex || 0);

        let currentItem = null;
        let nextItem = null;
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

        // Recalculate schedule starting times in cascade taking muted (0 duration) and extensions into account
        let rollingTime = null;
        let prevEndHour = -1;
        let dayOffset = 0;

        const mappedScheduleItems = [];

        for (let i = 0; i < processedItems.length; i++) {
            const item = processedItems[i];
            
            if (i === 0) {
                const startHour = parseInt((item.start || '00:00').split(':')[0]) || 0;
                rollingTime = getRowDateTime(item.start, now, false);
            }

            const startHour = rollingTime.getHours();
            if (prevEndHour > 18 && startHour < 6) {
                dayOffset = 1;
            }

            const startDate = new Date(rollingTime);
            const durationMin = item.isMuted ? 0 : item.effectiveDuration;
            const endDate = new Date(startDate.getTime() + (durationMin * 60000));
            prevEndHour = endDate.getHours();
            rollingTime = new Date(endDate);

            mappedScheduleItems.push({
                ...item,
                recalcStart: TimingEngine.formatTime(startDate),
                recalcEnd: TimingEngine.formatTime(endDate),
                startDate,
                endDate
            });
        }

        // Filter active (non-muted) items for execution pointer
        const executableItems = mappedScheduleItems.filter(item => !item.isMuted);

        // 1. AUTO SCHEDULE TRACKING MODE (Seguimiento según Horario Programado)
        if (status === 'live' && trackingMode === 'schedule' && executableItems.length > 0) {
            let foundIdx = -1;
            for (let i = 0; i < executableItems.length; i++) {
                const item = executableItems[i];
                if (now >= item.startDate && now < item.endDate) {
                    foundIdx = i;
                    break;
                }
            }

            if (foundIdx === -1 && now < executableItems[0].startDate) {
                currentIndex = 0;
                currentItem = executableItems[0];
                nextItem = executableItems[1] || null;
                const diffToStartSec = Math.max(0, Math.floor((executableItems[0].startDate.getTime() - now.getTime()) / 1000));
                elapsedSeconds = 0;
                remainingSeconds = diffToStartSec;
                progressPercent = 0;
            } else if (foundIdx === -1 && now >= executableItems[executableItems.length - 1].endDate) {
                currentIndex = executableItems.length - 1;
                currentItem = executableItems[currentIndex];
                nextItem = null;
                elapsedSeconds = (currentItem.effectiveDuration || 1) * 60;
                remainingSeconds = 0;
                progressPercent = 100;
            } else {
                if (foundIdx !== -1) {
                    currentIndex = foundIdx;
                    currentItem = executableItems[currentIndex];
                    nextItem = executableItems[currentIndex + 1] || null;
                    const totalDurSec = (currentItem.effectiveDuration || 1) * 60;
                    elapsedSeconds = Math.max(0, Math.floor((now.getTime() - currentItem.startDate.getTime()) / 1000));
                    remainingSeconds = Math.max(0, Math.floor((currentItem.endDate.getTime() - now.getTime()) / 1000));
                    progressPercent = Math.min(100, Math.max(0, (elapsedSeconds / totalDurSec) * 100));
                } else {
                    for (let i = 0; i < executableItems.length; i++) {
                        if (now < executableItems[i].startDate) {
                            currentIndex = i;
                            currentItem = executableItems[i];
                            nextItem = executableItems[i + 1] || null;
                            elapsedSeconds = 0;
                            remainingSeconds = Math.max(0, Math.floor((currentItem.startDate.getTime() - now.getTime()) / 1000));
                            progressPercent = 0;
                            break;
                        }
                    }
                }
            }
        } 
        // 2. MANUAL DIRECTOR TRACKING MODE (Control Manual)
        else if (status === 'live' && trackingMode === 'manual' && executableItems.length > 0 && currentIndex < executableItems.length) {
            currentItem = executableItems[currentIndex];
            nextItem = executableItems[currentIndex + 1] || null;
            const blockStartMs = liveState.currentBlockStartTime ? new Date(liveState.currentBlockStartTime).getTime() : now.getTime();
            const totalDurationSec = (currentItem.effectiveDuration || 1) * 60;

            elapsedSeconds = Math.max(0, Math.floor((now.getTime() - blockStartMs) / 1000));
            remainingSeconds = totalDurationSec - elapsedSeconds;

            if (remainingSeconds < 0) {
                isOvertime = true;
                overtimeSeconds = Math.abs(remainingSeconds);
                progressPercent = 100;
            } else {
                progressPercent = Math.min(100, Math.max(0, (elapsedSeconds / totalDurationSec) * 100));
            }
        } else if (executableItems.length > 0) {
            // Idle / Paused
            currentItem = executableItems[currentIndex] || executableItems[0];
            nextItem = executableItems[currentIndex + 1] || null;
            remainingSeconds = (currentItem ? currentItem.effectiveDuration : 0) * 60;
        }

        // Project remaining future blocks in manual mode
        let projectedCurrentTime = new Date();
        if (status === 'live' && trackingMode === 'manual') {
            const remainingCurrentBlockSec = Math.max(0, remainingSeconds);
            projectedCurrentTime = new Date(now.getTime() + remainingCurrentBlockSec * 1000);
        }

        // Enrich items for the UI table
        const enrichedItems = mappedScheduleItems.map((item) => {
            let rowState = 'future'; // 'completed' | 'active' | 'future' | 'muted'
            let liveStart = item.recalcStart;
            let liveEnd = item.recalcEnd;
            let rowProgress = 0;

            if (item.isMuted) {
                rowState = 'muted';
                liveStart = '--:--';
                liveEnd = '--:--';
                rowProgress = 0;
            } else if (trackingMode === 'schedule') {
                if (now >= item.endDate) {
                    rowState = 'completed';
                    rowProgress = 100;
                } else if (now >= item.startDate && now < item.endDate && status === 'live') {
                    rowState = 'active';
                    rowProgress = progressPercent;
                } else {
                    rowState = 'future';
                    rowProgress = 0;
                }
            } else {
                // Manual mode
                const execIdx = executableItems.findIndex(e => e.num === item.num);
                if (execIdx !== -1) {
                    if (execIdx < currentIndex) {
                        rowState = 'completed';
                        const hist = (liveState.history || []).find(h => h.num === item.num);
                        if (hist) {
                            liveStart = hist.actualStartFormatted || item.start;
                            liveEnd = hist.actualEndFormatted || item.end;
                        }
                        rowProgress = 100;
                    } else if (execIdx === currentIndex && status === 'live') {
                        rowState = 'active';
                        const blockStart = liveState.currentBlockStartTime ? new Date(liveState.currentBlockStartTime) : now;
                        liveStart = TimingEngine.formatTime(blockStart);
                        const projectedBlockEnd = new Date(blockStart.getTime() + (item.effectiveDuration * 60000));
                        liveEnd = TimingEngine.formatTime(projectedBlockEnd);
                        rowProgress = progressPercent;
                    } else if (status === 'live' && execIdx > currentIndex) {
                        rowState = 'future';
                        liveStart = TimingEngine.formatTime(projectedCurrentTime);
                        projectedCurrentTime = TimingEngine.addMinutes(projectedCurrentTime, item.effectiveDuration);
                        liveEnd = TimingEngine.formatTime(projectedCurrentTime);
                    }
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

        const lastMapped = mappedScheduleItems[mappedScheduleItems.length - 1];
        const projectedEndTime = (status === 'live' && trackingMode === 'manual') 
            ? TimingEngine.formatTime(projectedCurrentTime) 
            : (lastMapped ? lastMapped.recalcEnd : baseComputed.metrics.endTimeFormatted);

        return {
            status,
            trackingMode,
            currentIndex,
            currentItem,
            nextItem,
            elapsedSeconds,
            remainingSeconds,
            progressPercent,
            isOvertime,
            overtimeSeconds,
            alertLevel,
            items: enrichedItems,
            history: liveState.history || [],
            projectedEndTime
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = LiveEngine;
}
