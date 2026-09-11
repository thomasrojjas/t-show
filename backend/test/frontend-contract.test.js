const test = require('node:test');
const assert = require('node:assert/strict');
const TimingEngine = require('../../frontend/js/timing-engine');

test('schedule rows retain block ids for compact rundown alignment', () => {
  const result = TimingEngine.computeSchedule({
    convocatoriaTime: '18:30', convocatoriaDuration: 30,
    doorsTime: '19:30', doorsDuration: 60, showStartMode: 'auto'
  }, [{ id: 'block-script', type: 'ANIMACIÓN', title: 'Intervención', duration: 15 }]);
  assert.equal(result.tableRows.find(row => row.title === 'Intervención').blockId, 'block-script');
});
