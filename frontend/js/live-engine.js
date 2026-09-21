/* Shared deterministic live math and transitions. Also used by the API. */
const LiveTiming = typeof module !== 'undefined' && module.exports ? require('./timing-engine') : TimingEngine;
const LiveEngine = {
    defaults(state = {}) {
        return { status: 'idle', trackingMode: 'schedule', currentIndex: 0, currentBlockStartTime: null,
            mutedBlockNums: [], omittedItemNums: [], blockExtensions: {}, history: [], ...state };
    },
    zone(project) {
        const zone = project.timeZone || project.timezone || 'America/Santiago';
        new Intl.DateTimeFormat('en', { timeZone: zone }).format();
        return zone;
    },
    dateInZone(now, zone) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
        const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
        return `${p.year}-${p.month}-${p.day}`;
    },
    zonedTime(date, time, zone) {
        const [y, m, d] = date.split('-').map(Number);
        const value = String(time || '00:00');
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('El horario debe usar el formato HH:MM.');
        const [h, min] = value.split(':').map(Number);
        const target = Date.UTC(y, m - 1, d, h, min);
        const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' });
        let epoch = target;
        for (let i = 0; i < 4; i++) {
            const p = Object.fromEntries(formatter.formatToParts(epoch).map(x => [x.type, x.value]));
            const actual = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
            if (actual === target) return epoch;
            epoch += target - actual;
        }
        throw new Error('El horario coincide con un cambio de hora. Ajusta la hora de inicio en la Escaleta.');
    },
    formatTimeSeconds(date, zone = 'America/Santiago') {
        return new Intl.DateTimeFormat('es-CL', { timeZone: zone, hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).format(new Date(date));
    },
    formatDurationSeconds(seconds) {
        const n = Math.floor(Math.abs(seconds || 0));
        return (seconds < 0 ? '−' : '') + (n >= 3600 ? String(Math.floor(n / 3600)).padStart(2, '0') + ':' : '') +
            String(Math.floor(n / 60) % 60).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
    },
    scheduleStart(project) {
        const schedule = LiveTiming.computeSchedule(project, project.blocks || []);
        const first = schedule.tableRows[0];
        if (!first?.startAt) throw new Error('Agrega al menos un bloque o una convocatoria con duración.');
        return { ...schedule, first, startAt: first.startAt };
    },
    scheduleKey(project) {
        const blocks = (project?.blocks || []).map(block => ({ id:block.id || null, type:block.type || null, duration:Number(block.duration) || 0, bis:Number(block.bis) || 0 }));
        return JSON.stringify({ eventDate:project?.eventDate || null, timeZone:this.zone(project || {}), convocatoriaTime:project?.convocatoriaTime || '18:30', convocatoriaDuration:Number(project?.convocatoriaDuration) || 0, doorsTime:project?.doorsTime || '19:30', doorsDuration:Number(project?.doorsDuration) || 0, showStartMode:project?.showStartMode || 'auto', showStartTimeInput:project?.showStartTimeInput || '20:30', blocks });
    },
    resolveState(project, input = {}, now = Date.now()) {
        const state = this.defaults(input);
        if (state.status !== 'scheduled') return state;
        const scheduledAt = Date.parse(state.scheduledAt || '');
        const planChanged = state.scheduledPlanKey && state.scheduledPlanKey !== this.scheduleKey(project);
        if (!Number.isFinite(scheduledAt) || planChanged) {
            state.status = 'schedule-invalidated';
            state.scheduleInvalidReason = planChanged ? 'schedule_changed' : 'invalid_schedule';
            return state;
        }
        if (now >= scheduledAt) {
            state.status = 'live'; state.startedAt = state.startedAt || state.scheduledAt;
            state.eventDate = project?.eventDate || state.eventDate;
        }
        return state;
    },
    computeLiveSnapshot(project, input = {}, now = Date.now()) {
        if (!project) return null;
        const state = this.resolveState(project, input, now), zone = this.zone(project);
        const effectiveNow = state.status === 'paused' ? Date.parse(state.pausedAt || new Date(now).toISOString()) :
            state.status === 'finished' ? Date.parse(state.finishedAt || new Date(now).toISOString()) : now;
        const date = project.eventDate || state.eventDate;
        if (!date) return { status: state.status === 'idle' ? 'idle' : 'schedule-invalidated', scheduleInvalidated: true, scheduleInvalidReason: 'missing_event_date', trackingMode: state.trackingMode, currentIndex: 0, currentItem: null, previousItem: null, nextItem: null, elapsedSeconds: 0, remainingSeconds: 0, progressPercent: 0, items: [], executable: [], waiting: false, scheduleEnded: false, zone, projectedEndMs: null, history: state.history, isOvertime: false, alertLevel: 'normal' };
        const rows = LiveTiming.computeSchedule(project, project.blocks || []).tableRows;
        const items = rows.map(row => {
            const startMs = row.startAt ? Date.parse(row.startAt) : this.zonedTime(date, row.start, zone);
            const raw = row.raw || (project.blocks || []).find(b => b.id && b.id === row.blockId) || {};
            const key = row.blockId || `segment:${row.type}:${row.num}`;
            const isMuted = state.mutedBlockNums.includes(row.num) || (state.mutedBlockIds || []).includes(key);
            const duration = row.duration + (state.trackingMode === 'manual' ? Number(state.blockExtensions[key] ?? state.blockExtensions[row.num] ?? 0) : 0);
            return { ...row, key, raw, isMuted, effectiveDuration: duration, startMs, endMs: row.endAt ? Date.parse(row.endAt) : startMs + row.duration * 60000 };
        }).filter(row => !state.omittedItemNums.includes(row.num));
        const executable = items.filter(row => !row.isMuted);
        let index = state.currentBlockId ? executable.findIndex(x => x.key === state.currentBlockId) : state.currentIndex;
        if (index < 0) index = 0;
        let current = executable[index] || executable[0], next = null, elapsed = 0, remaining = current?.effectiveDuration * 60 || 0;
        let waiting = false, scheduleEnded = false;
        const running = !['idle', 'schedule-invalidated'].includes(state.status);
        if (state.trackingMode === 'schedule' && running) {
            index = executable.findIndex(row => effectiveNow < row.endMs);
            scheduleEnded = executable.length > 0 && index === -1;
            if (scheduleEnded) index = executable.length - 1;
            current = executable[index] || null;
            waiting = !!current && effectiveNow < current.startMs;
            elapsed = current ? Math.min(current.duration * 60, Math.max(0, (effectiveNow - current.startMs) / 1000)) : 0;
            remaining = current ? Math.max(0, ((waiting ? current.startMs : current.endMs) - effectiveNow) / 1000) : 0;
        } else if (state.trackingMode === 'manual' && running && current) {
            elapsed = Math.max(0, (effectiveNow - Date.parse(state.currentBlockStartTime || new Date(effectiveNow).toISOString())) / 1000);
            remaining = current.effectiveDuration * 60 - elapsed;
        }
        next = executable[index + 1] || null;
        const previous = executable[index - 1] || null;
        const progress = current && !waiting ? Math.min(100, elapsed / (current.effectiveDuration * 60) * 100) : 0;
        for (const row of items) {
            const execIndex = executable.indexOf(row);
            row.rowState = row.isMuted ? 'muted' : !running ? 'future' :
                state.trackingMode === 'schedule' ? (effectiveNow >= row.endMs ? 'completed' : row === current && !waiting ? 'active' : 'future') :
                execIndex < index || row === current && state.status === 'finished' ? 'completed' : row === current ? 'active' : 'future';
        }
        const projectedEndMs = state.trackingMode === 'manual' && current && !['idle','scheduled','schedule-invalidated'].includes(state.status) ?
            effectiveNow + (Math.max(0, remaining) + executable.slice(index + 1).reduce((sum, row) => sum + row.effectiveDuration * 60, 0)) * 1000 :
            executable.at(-1)?.endMs;
        return { status: state.status, trackingMode: state.trackingMode, currentIndex: index, currentItem: current, previousItem: previous, nextItem: next,
            elapsedSeconds: elapsed, remainingSeconds: state.status === 'finished' ? 0 : remaining,
            progressPercent: progress, items, executable, waiting, scheduleEnded, zone, projectedEndMs,
            history: state.history, scheduledAt: state.scheduledAt || null, scheduleInvalidated: state.status === 'schedule-invalidated', isOvertime: remaining < 0, alertLevel: remaining < 0 ? 'error' : !waiting && remaining <= 60 ? 'warning' : 'normal' };
    },
    transition(project, input, command, permission, now = Date.now()) {
        const manager = ['owner', 'admin'].includes(permission);
        if (!manager && permission !== 'editor') throw new Error('No tienes permiso para operar este evento.');
        const state = this.resolveState(project, JSON.parse(JSON.stringify(input || {})), now);
        const snap = this.computeLiveSnapshot(project, state, now);
        const stamp = new Date(now).toISOString(), action = command.action;
        const requireState = (...allowed) => { if (!allowed.includes(state.status)) throw new Error('La acción no está disponible en el estado actual.'); };
        const manualLive = () => { requireState('live'); if (state.trackingMode !== 'manual' || !snap.currentItem) throw new Error('Esta acción requiere un bloque en modo manual.'); };
        const record = () => {
            if (state.trackingMode !== 'manual' || !snap.currentItem || !state.currentBlockStartTime) return;
            const row = snap.currentItem;
            state.history.push({ key: row.key, num: row.num, title: row.title, type: row.type, plannedStart: row.start,
                plannedDuration: row.duration, actualStart: state.actualBlockStartedAt || state.currentBlockStartTime,
                actualEnd: stamp, actualDurationMinutes: snap.elapsedSeconds / 60, diffMinutes: snap.elapsedSeconds / 60 - row.duration, source: 'manual' });
        };
        if (action === 'schedule') {
            if (!manager) throw new Error('Solo el propietario o administrador puede programar el inicio.');
            requireState('idle', 'schedule-invalidated');
            const schedule = this.scheduleStart(project);
            const startMs = Date.parse(schedule.startAt);
            if (!Number.isFinite(startMs)) throw new Error('La fecha y hora de inicio no son válidas.');
            if (startMs <= now && !command.startNow) throw new Error('La hora de inicio ya pasó. Confirma iniciar ahora para mostrar el bloque correspondiente.');
            if (startMs <= now) {
                state.status = 'live'; state.startedAt = stamp; state.eventDate = project.eventDate;
                state.trackingMode = 'schedule'; state.scheduledAt = stamp; state.scheduleZone = schedule.zone;
                state.scheduledPlanKey = this.scheduleKey(project); state.scheduledProjectVersion = project.documentVersion ?? null; state.scheduleSource = 'late-start';
                return state;
            }
            state.status = 'scheduled'; state.scheduledAt = schedule.startAt; state.scheduleZone = schedule.zone;
            state.scheduledPlanKey = this.scheduleKey(project); state.scheduledProjectVersion = project.documentVersion ?? null; state.eventDate = project.eventDate;
            state.scheduleSource = 'event-start'; state.currentIndex = 0; state.currentBlockId = null;
        } else if (action === 'cancel-schedule') {
            if (!manager) throw new Error('Solo el propietario o administrador puede cancelar la programación.');
            requireState('scheduled', 'schedule-invalidated');
            state.status = 'idle';
            delete state.scheduledAt; delete state.scheduleZone; delete state.scheduledPlanKey; delete state.scheduledProjectVersion; delete state.scheduleSource; delete state.scheduleInvalidReason;
        } else if (action === 'start') {
            requireState('idle');
            if (!snap.executable.length) throw new Error('Agrega bloques con duración antes de iniciar.');
            state.status = 'live'; state.startedAt = stamp;
            state.eventDate = project.eventDate || this.dateInZone(now, snap.zone);
            state.currentBlockStartTime = stamp; state.actualBlockStartedAt = stamp;
        } else if (action === 'pause') {
            requireState('live'); state.status = 'paused'; state.pausedAt = stamp;
        } else if (action === 'resume') {
            requireState('paused');
            if (state.trackingMode === 'manual' && state.pausedAt && state.currentBlockStartTime)
                state.currentBlockStartTime = new Date(Date.parse(state.currentBlockStartTime) + now - Date.parse(state.pausedAt)).toISOString();
            state.status = 'live'; state.pausedAt = null;
        } else if (action === 'mode') {
            requireState('idle', 'live', 'paused');
            if (!['manual', 'schedule'].includes(command.mode)) throw new Error('Modo inválido.');
            if (state.trackingMode === command.mode) return state;
            if (command.mode === 'manual') {
                state.currentIndex = snap.currentIndex; state.currentBlockId = snap.currentItem?.key;
                const anchor = state.status === 'paused' ? Date.parse(state.pausedAt || stamp) : now;
                state.currentBlockStartTime = new Date(anchor - snap.elapsedSeconds * 1000).toISOString();
                state.actualBlockStartedAt = stamp;
            } else { record(); state.currentBlockId = null; }
            state.trackingMode = command.mode;
        } else if (action === 'next') {
            manualLive();
            if (!snap.nextItem) throw new Error('Estás en el último bloque. Para cerrar la sesión usa Finalizar evento.');
            record();
            state.currentIndex = snap.currentIndex + 1; state.currentBlockId = snap.nextItem.key;
            state.currentBlockStartTime = stamp; state.actualBlockStartedAt = stamp;
        } else if (action === 'previous') {
            manualLive();
            if (!snap.previousItem) throw new Error('No hay un bloque anterior disponible.');
            record();
            state.currentIndex = snap.currentIndex - 1;
            state.currentBlockId = snap.previousItem.key;
            state.currentBlockStartTime = stamp;
            state.actualBlockStartedAt = stamp;
        } else if (action === 'extend') {
            manualLive();
            if (![2, 5, 10].includes(command.minutes)) throw new Error('Extensión inválida.');
            state.blockExtensions[snap.currentItem.key] = Number(state.blockExtensions[snap.currentItem.key] ?? state.blockExtensions[snap.currentItem.num] ?? 0) + command.minutes;
        } else if (action === 'restart-block') {
            manualLive(); record(); state.currentBlockStartTime = stamp; state.actualBlockStartedAt = stamp;
        } else if (action === 'exclude' || action === 'restore') {
            requireState('idle', 'live', 'paused');
            const row = snap.items.find(x => x.key === command.key);
            if (!row || (action === 'exclude' && row.rowState !== 'future')) throw new Error('Solo puedes excluir bloques futuros.');
            if (action === 'restore' && state.status !== 'idle' && (state.trackingMode === 'schedule' ? row.startMs <= now : row.num <= (snap.currentItem?.num || 0)))
                throw new Error('Solo puedes restaurar bloques futuros.');
            state.mutedBlockIds = (state.mutedBlockIds || []).filter(key => key !== row.key);
            state.mutedBlockNums = state.mutedBlockNums.filter(num => num !== row.num);
            if (action === 'exclude') state.mutedBlockIds.push(row.key);
        } else if (action === 'finish') {
            if (!manager) throw new Error('Solo el propietario o administrador puede finalizar.');
            requireState('live', 'paused'); record(); state.status = 'finished'; state.finishedAt = stamp;
        } else if (action === 'reopen') {
            if (!manager) throw new Error('Solo el propietario o administrador puede reabrir.');
            requireState('finished');
            if (!snap.executable.length) throw new Error('Agrega bloques antes de reabrir.');
            if (!project.eventDate) throw new Error('Confirma la fecha del evento en la Escaleta antes de reabrir.');
            // Explicit recovery: follow the confirmed project date, never guess a manual cue.
            // Keep the previous closure and all execution records for audit and reporting.
            state.reopenHistory = [...(state.reopenHistory || []), {
                reopenedAt: stamp, previousFinishedAt: state.finishedAt || null,
                previousEventDate: state.eventDate || null, previousTrackingMode: state.trackingMode,
                previousBlockId: state.currentBlockId || null
            }];
            state.status = 'live'; state.trackingMode = 'schedule'; state.eventDate = project.eventDate;
            state.finishedAt = null; state.pausedAt = null; state.currentBlockId = null;
            state.currentIndex = 0; state.currentBlockStartTime = null; state.actualBlockStartedAt = null;
        } else if (action === 'reset') {
            if (!manager) throw new Error('Solo el propietario o administrador puede reiniciar.');
            requireState('idle', 'paused', 'finished');
            return this.defaults();
        } else throw new Error('Acción desconocida. Actualiza la consola.');
        return state;
    }
};
if (typeof module !== 'undefined' && module.exports) module.exports = LiveEngine;
