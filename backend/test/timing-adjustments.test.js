const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTimingPreview } = require('../lib/timing-adjustments');

test('automatic timing recovery distributes minutes across flexible blocks', () => {
  const preview = buildTimingPreview({
    targetRecoveryMinutes: 10,
    blocks: [
      { blockId: 'a', originalMinutes: 30, minimumMinutes: 20, flexible: true },
      { blockId: 'b', originalMinutes: 20, minimumMinutes: 15, flexible: true },
      { blockId: 'c', originalMinutes: 15, minimumMinutes: 15, fixed: true },
    ],
  });
  assert.equal(preview.recoveredMinutes, 10);
  assert.equal(preview.unrecoveredMinutes, 0);
  assert.equal(preview.blocks[0].proposedMinutes, 23);
  assert.equal(preview.blocks[1].proposedMinutes, 17);
  assert.equal(preview.blocks[2].proposedMinutes, 15);
});

test('automatic timing recovery reports unavailable minutes without crossing minimums', () => {
  const preview = buildTimingPreview({
    targetRecoveryMinutes: 20,
    blocks: [{ originalMinutes: 10, minimumMinutes: 8, flexible: true }],
  });
  assert.equal(preview.recoveredMinutes, 2);
  assert.equal(preview.unrecoveredMinutes, 18);
  assert.equal(preview.blocks[0].proposedMinutes, 8);
});

test('explicit proposals remain compatible and fixed blocks cannot be shortened', () => {
  const preview = buildTimingPreview({ blocks: [{ originalMinutes: 20, proposedMinutes: 18, minimumMinutes: 10 }] });
  assert.equal(preview.blocks[0].proposedMinutes, 18);
  assert.throws(() => buildTimingPreview({ blocks: [{ originalMinutes: 20, proposedMinutes: 18, fixed: true }] }), /fijado/);
});
