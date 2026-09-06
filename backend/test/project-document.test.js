const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBlock, normalizeBlocks, normalizedBlockToLegacy } = require('../services/projectDocument');

test('normalizes legacy blocks without losing operational content', () => {
  const block = normalizeBlock({ itemNum: 7, type: 'show', title: 'Acto central', startTime: '20:30', duration: '15', notes: 'Audio listo', animator_script: 'Buenas noches' }, 0);
  assert.deepEqual(block, {
    externalId: '7', position: 0, type: 'show', title: 'Acto central', start: '20:30', duration: 15, end: null,
    status: 'pending', notes: 'Audio listo', animatorScript: 'Buenas noches'
  });
});
test('normalizes duplicate and invalid block values safely', () => {
  const blocks = normalizeBlocks([{ id: 'same', duration: -5 }, { id: 'same', duration: 'bad', status: 'unknown' }]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].duration, 0);
  assert.equal(blocks[1].duration, 0);
  assert.notEqual(blocks[0].externalId, blocks[1].externalId);
  assert.equal(blocks[1].status, 'pending');
});

test('maps normalized rows back to the legacy frontend contract', () => {
  const result = normalizedBlockToLegacy({ external_id: 'b1', block_type: 'music', title: 'Banda', start_time: '21:00', duration_minutes: 30, end_time: '21:30', status: 'running', notes: '', animator_script: '', metadata: { bis: 5 } });
  assert.equal(result.id, 'b1');
  assert.equal(result.bis, 5);
  assert.equal(result.duration, 30);
});
