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
test('manual switch preserves elapsed and explicit next uses actual scheduled index', () => {
  let state = command({},'start');
  state = command(state,'mode','20:15',{mode:'manual'});
  assert.equal(engine.computeLiveSnapshot(project,state,at('20:15')).remainingSeconds,300);
  state = command(state,'next','20:16');
  assert.equal(state.currentBlockId,'three'); assert.equal(state.history[0].key,'two');
  state = command(state,'next','20:20');
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
  for (const action of ['start','pause','resume','next','extend','finish','reset','exclude','mode','restart-block'])
    assert.throws(()=>command(state,action,'20:05',{},'viewer'));
  assert.throws(()=>command(state,'finish','20:05',{},'editor'));
  assert.throws(()=>command({...state,status:'paused'},'reset','20:05',{},'editor'));
  assert.equal(command(state,'pause','20:05',{},'editor').status,'paused');
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
