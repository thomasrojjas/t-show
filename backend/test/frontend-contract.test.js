const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TimingEngine = require('../../frontend/js/timing-engine');

test('schedule rows retain block ids for compact rundown alignment', () => {
  const result = TimingEngine.computeSchedule({
    convocatoriaTime: '18:30', convocatoriaDuration: 30,
    doorsTime: '19:30', doorsDuration: 60, showStartMode: 'auto'
  }, [{ id: 'block-script', type: 'ANIMACIÓN', title: 'Intervención', duration: 15 }]);
  assert.equal(result.tableRows.find(row => row.title === 'Intervención').blockId, 'block-script');
});

test('schedule dates are resolved in America/Santiago and retain full instants across midnight', () => {
  const result = TimingEngine.computeSchedule({
    eventDate: '2026-09-17', timeZone: 'America/Santiago', convocatoriaTime: '23:30', convocatoriaDuration: 30,
    doorsTime: '00:10', doorsDuration: 20, showStartMode: 'manual', showStartTimeInput: '00:40'
  }, [{ id:'overnight', type:'SHOW', title:'Trasnoche', duration:30 }]);
  assert.equal(result.tableRows[0].start, '23:30');
  assert.equal(result.tableRows[1].start, '00:10');
  assert.equal(result.tableRows[2].start, '00:40');
  assert.equal(result.tableRows[1].startAt, '2026-09-18T03:10:00.000Z');
  assert.equal(result.tableRows[2].endAt, '2026-09-18T04:10:00.000Z');
});

test('schedule editor carries project identity and date when saving blocks', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../frontend/js/app.js'), 'utf8');
  assert.match(app, /eventDate: this\.currentProject\.eventDate/);
  assert.match(app, /timeZone: this\.currentProject\.timeZone/);
  assert.match(app, /this\.currentProject = \{ \.\.\.\(this\.currentProject/);
});

test('direct schedule navigation resolves project context before showing the selector', () => {
  const navigation = fs.readFileSync(path.join(__dirname, '../../frontend/js/workspace-nav.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../../frontend/css/glass-workspace.css'), 'utf8');
  assert.match(navigation, /ApiClient\.getProject\(currentProject\)/);
  assert.match(navigation, /workspace-context-pending/);
  assert.match(styles, /workspace-context-pending[\s\S]*data-route="projects"/);
});

test('block editing opens inline in the selected rundown card', () => {
  const manager = fs.readFileSync(path.join(__dirname, '../../frontend/js/blocks-manager.js'), 'utf8');
  assert.match(manager, /if\(expanded\)this\.renderDetail\(editable,row,i\)/);
  assert.match(manager, /aria-expanded="\$\{expanded\}"/);
  assert.doesNotMatch(manager, /this\.container\.appendChild\(detail\)/);
});

test('workspace navigation keeps the active project when opening live mode', () => {
  const navigation = fs.readFileSync(path.join(__dirname, '../../frontend/js/workspace-nav.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../../frontend/css/internal-theme.css'), 'utf8');
  assert.match(navigation, /'shellLiveLink','summaryLiveLink','scheduleLive'/);
  assert.match(navigation, /live\.html\?project=\$\{encodeURIComponent\(currentProject\)\}/);
  assert.match(styles, /workspace-nav-brand\{background:none!important\}/);
  assert.match(styles, /workspace-user-copy strong\{color:var\(--workspace-sidebar-text/);
});
