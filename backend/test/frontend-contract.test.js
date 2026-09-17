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

test('direct schedule navigation resolves project context before showing the selector', () => {
  const navigation = fs.readFileSync(path.join(__dirname, '../../frontend/js/workspace-nav.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../../frontend/css/glass-workspace.css'), 'utf8');
  assert.match(navigation, /ApiClient\.getProject\(currentProject\)/);
  assert.match(navigation, /workspace-context-pending/);
  assert.match(styles, /workspace-context-pending[\s\S]*data-route="projects"/);
});
