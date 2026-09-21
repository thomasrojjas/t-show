const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../../frontend/js/live-engine');
const project = { eventDate:'2026-09-11', timeZone:'America/Santiago', convocatoriaDuration:0, doorsDuration:0,
  showStartMode:'fixed', showStartTimeInput:'20:00', blocks:[
    { id:'one', title:'Apertura', type:'SHOW', duration:10, animator_script:'Bienvenidos' },
    { id:'two', title:'Entrevista', type:'OTRO', duration:10, notes:'Micrófono 2' },
    { id:'three', title:'Cierre', type:'SHOW', duration:10 }
  ] };
const at = time => engine.zonedTime(project.eventDate, time, project.timeZone);
const command = (state, action, time='20:05', extra={}, role='owner') => engine.transition(project,state,{action,...extra},role,at(time));
test('scheduled start respects event date, zone and current block', () => {
  const state = command({},'start');
  const snap = engine.computeLiveSnapshot(project,state,at('20:15'));
  assert.equal(snap.currentItem.key,'two'); assert.equal(snap.remainingSeconds,300);
  assert.equal(snap.currentItem.raw.notes,'Micrófono 2');
  assert.equal(engine.computeLiveSnapshot(project,state,at('19:50')).remainingSeconds,600);
  assert.equal(engine.computeLiveSnapshot(project,state,at('19:50')).waiting,true);
});
test('scheduled pause freezes reading, resume follows original time', () => {
  const paused = command(command({},'start'),'pause','20:06');
  const frozen = engine.computeLiveSnapshot(project,paused,at('20:15'));
  assert.equal(frozen.currentItem.key,'one'); assert.equal(frozen.remainingSeconds,240);
  const resumed = command(paused,'resume','20:15');
  assert.equal(engine.computeLiveSnapshot(project,resumed,at('20:15')).currentItem.key,'two');
});
test('schedule completion does not fabricate executions or restart', () => {
  const state = command({},'start','20:45');
  const snap = engine.computeLiveSnapshot(project,state,at('20:45'));
  assert.equal(snap.scheduleEnded,true); assert.equal(snap.remainingSeconds,0); assert.equal(snap.history.length,0);
});

test('scheduled start becomes live from the first scheduled row without a console timer', () => {
  const scheduledProject = {...project, documentVersion:12};
  const run = (state, action, time, extra={}) => engine.transition(scheduledProject, state, {action,...extra}, 'owner', engine.zonedTime(scheduledProject.eventDate, time, scheduledProject.timeZone));
  const scheduled = run({}, 'schedule', '19:00');
  assert.equal(scheduled.status,'scheduled');
  assert.equal(scheduled.scheduledProjectVersion,12);
  const before = engine.computeLiveSnapshot(scheduledProject, scheduled, at('19:59'));
  assert.equal(before.status,'scheduled'); assert.equal(before.waiting,true);
  const after = engine.computeLiveSnapshot(scheduledProject, scheduled, at('20:01'));
  assert.equal(after.status,'live'); assert.equal(after.currentItem.key,'one');
});

test('scheduled execution is invalidated by a pauta version change and can be cancelled', () => {
  const scheduledProject = {...project, documentVersion:12};
  const run = (state, action, time, extra={}) => engine.transition(scheduledProject, state, {action,...extra}, 'owner', engine.zonedTime(scheduledProject.eventDate, time, scheduledProject.timeZone));
  const scheduled = run({}, 'schedule', '19:00');
  const changed = engine.computeLiveSnapshot({...scheduledProject, documentVersion:13, blocks:[{...project.blocks[0],duration:11}, project.blocks[1], project.blocks[2]]}, scheduled, at('19:00'));
  assert.equal(changed.status,'schedule-invalidated'); assert.equal(changed.scheduleInvalidated,true);
  const cancelled = engine.transition({...scheduledProject, documentVersion:13, blocks:[{...project.blocks[0],duration:11}, project.blocks[1], project.blocks[2]]}, scheduled, {action:'cancel-schedule'}, 'owner', engine.zonedTime(scheduledProject.eventDate, '19:00', scheduledProject.timeZone));
  assert.equal(cancelled.status,'idle'); assert.equal(cancelled.scheduledAt,undefined);
});

test('late schedule start requires explicit confirmation and follows the current scheduled block', () => {
  const scheduledProject = {...project, documentVersion:12};
  const run = (extra={}) => engine.transition(scheduledProject, {}, {action:'schedule',...extra}, 'owner', engine.zonedTime(scheduledProject.eventDate, '20:05', scheduledProject.timeZone));
  assert.throws(()=>run(),/Confirma iniciar ahora/);
  const started = run({startNow:true});
  assert.equal(started.status,'live'); assert.equal(started.trackingMode,'schedule');
  assert.equal(engine.computeLiveSnapshot(scheduledProject,started,at('20:15')).currentItem.key,'two');
});
test('manual switch preserves elapsed and explicit next uses actual scheduled index', () => {
  let state = command({},'start');
  state = command(state,'mode','20:15',{mode:'manual'});
  assert.equal(engine.computeLiveSnapshot(project,state,at('20:15')).remainingSeconds,300);
  state = command(state,'next','20:16');
  assert.equal(state.currentBlockId,'three'); assert.equal(state.history[0].key,'two');
  const before = JSON.stringify(state);
  assert.throws(()=>command(state,'next','20:20'),/último bloque/);
  assert.equal(JSON.stringify(state),before);
  assert.equal(state.status,'live');
  state = command(state,'finish','20:20');
  assert.equal(state.status,'finished'); assert.equal(state.history.length,2);
});
test('manual pause excludes paused time on resume and extension is effective', () => {
  let state = command(command({},'mode','20:00',{mode:'manual'}),'start','20:00');
  state = command(state,'pause','20:04');
  state = command(state,'resume','20:12');
  assert.equal(engine.computeLiveSnapshot(project,state,at('20:12')).elapsedSeconds,240);
  state = command(state,'extend','20:12',{minutes:5});
  assert.equal(engine.computeLiveSnapshot(project,state,at('20:12')).remainingSeconds,660);
  assert.throws(()=>command(state,'extend','20:12',{minutes:0}));
});
test('finish is finished, preserves history; live reset is forbidden', () => {
  const running = command({},'start');
  assert.throws(()=>command(running,'reset'));
  const finished = command(running,'finish');
  assert.equal(finished.status,'finished'); assert.ok(finished.finishedAt);
  assert.throws(()=>command(finished,'resume'));
  assert.equal(command(finished,'reset').status,'idle');
});
test('permissions are enforced on all transitions', () => {
  const state = command({},'start');
  for (const action of ['start','pause','resume','next','extend','finish','reset','reopen','exclude','mode','restart-block'])
    assert.throws(()=>command(state,action,'20:05',{},'viewer'));
  assert.throws(()=>command(state,'finish','20:05',{},'editor'));
  assert.throws(()=>command({...state,status:'paused'},'reset','20:05',{},'editor'));
  assert.equal(command(state,'pause','20:05',{},'editor').status,'paused');
});

test('reopen follows the project date and preserves history, exclusions and extensions', () => {
  const finished = {status:'finished',trackingMode:'manual',eventDate:'2026-09-09',currentIndex:2,currentBlockId:'three',
    startedAt:'2026-09-09T23:00:00Z',finishedAt:'2026-09-11T23:10:00Z',pausedAt:null,
    currentBlockStartTime:'2026-09-11T23:00:00Z',history:[{key:'three',actualEnd:'2026-09-11T23:10:00Z'}],
    blockExtensions:{three:5},mutedBlockIds:['three']};
  const copy = JSON.stringify(finished);
  const reopened = command(finished,'reopen','20:15');
  assert.equal(reopened.status,'live'); assert.equal(reopened.trackingMode,'schedule');
  assert.equal(reopened.eventDate,project.eventDate);
  assert.equal(reopened.finishedAt,null); assert.equal(reopened.currentBlockStartTime,null);
  assert.equal(engine.computeLiveSnapshot(project,reopened,at('20:15')).currentItem.key,'two');
  assert.deepEqual(reopened.history,finished.history);
  assert.deepEqual(reopened.blockExtensions,finished.blockExtensions);
  assert.deepEqual(reopened.mutedBlockIds,finished.mutedBlockIds);
  assert.equal(reopened.reopenHistory[0].previousFinishedAt,finished.finishedAt);
  assert.equal(JSON.stringify(finished),copy);
  assert.throws(()=>command(finished,'reopen','20:15',{},'editor'),/administrador/);
  assert.throws(()=>command(reopened,'reopen','20:15'),/estado actual/);
  assert.throws(()=>engine.transition({...project,eventDate:''},finished,{action:'reopen'},'owner',at('20:15')),/fecha/);
  const late = command(finished,'reopen','23:00');
  assert.equal(engine.computeLiveSnapshot(project,late,at('23:00')).scheduleEnded,true);
  assert.equal(late.status,'live');
});
test('only future cues may be excluded or restored', () => {
  let state = command({},'start');
  assert.throws(()=>command(state,'exclude','20:05',{key:'one'}));
  state = command(state,'exclude','20:05',{key:'two'});
  assert.equal(engine.computeLiveSnapshot(project,state,at('20:15')).currentItem.key,'three');
  assert.throws(()=>command(state,'restore','20:15',{key:'two'}));
  state = command(state,'restore','20:06',{key:'two'});
  assert.equal(engine.computeLiveSnapshot(project,state,at('20:15')).currentItem.key,'two');
});
test('midnight and legacy sessions retain data', () => {
  const p = {...project, showStartTimeInput:'23:50'};
  const nextDay = engine.zonedTime('2026-09-12','00:05',project.timeZone);
  const snap = engine.computeLiveSnapshot(p,{status:'live'},nextDay);
  assert.equal(snap.currentItem.key,'two'); assert.equal(snap.remainingSeconds,300);
  assert.equal(engine.defaults({history:[{num:1}]}).history.length,1);
});
test('Santiago DST date is resolved independently of host timezone', () => {
  assert.equal(new Date(engine.zonedTime('2026-07-11','20:00','America/Santiago')).toISOString(),'2026-07-12T00:00:00.000Z');
  assert.equal(new Date(at('20:00')).toISOString(),'2026-09-11T23:00:00.000Z');
});
test('transitions never mutate the confirmed input state', () => {
  const state = command({},'start'); const copy = JSON.stringify(state);
  command(state,'pause'); assert.equal(JSON.stringify(state),copy);
});
