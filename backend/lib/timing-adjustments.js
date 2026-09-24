function normalizeBlock(block, index) {
  const originalMinutes = Number(block.originalMinutes);
  const minimumMinutes = Math.max(1, Number(block.minimumMinutes) || 1);
  if (!Number.isFinite(originalMinutes) || originalMinutes < minimumMinutes) {
    throw new Error(`La duración del bloque ${index + 1} no es válida.`);
  }
  return {
    blockId: block.blockId || null,
    index,
    title: String(block.title || '').slice(0, 180),
    originalMinutes,
    proposedMinutes: originalMinutes,
    minimumMinutes,
    fixed: Boolean(block.fixed),
    flexible: block.flexible !== false && !block.fixed,
  };
}

function buildTimingPreview(input = {}) {
  const source = Array.isArray(input.blocks) ? input.blocks : [];
  if (!source.length) throw new Error('Debes incluir bloques para simular.');
  const blocks = source.map(normalizeBlock);
  const target = Math.max(0, Math.floor(Number(input.targetRecoveryMinutes) || 0));

  // Explicit proposals remain supported for older clients. Automatic mode is
  // used when a recovery target is supplied and distributes minutes across
  // flexible blocks without crossing their configured minimums.
  if (!target) {
    for (const [index, block] of source.entries()) {
      const proposed = Number(block.proposedMinutes ?? block.originalMinutes);
      if (!Number.isFinite(proposed) || proposed < blocks[index].minimumMinutes) {
        throw new Error(`La duración propuesta del bloque ${index + 1} no es válida.`);
      }
      if (blocks[index].fixed && proposed !== blocks[index].originalMinutes) {
        throw new Error(`El bloque ${index + 1} está fijado y no puede recortarse.`);
      }
      blocks[index].proposedMinutes = proposed;
    }
  } else {
    let remaining = target;
    const available = () => blocks.map(block => block.flexible ? Math.max(0, block.proposedMinutes - block.minimumMinutes) : 0);
    while (remaining > 0) {
      const capacity = available();
      const total = capacity.reduce((sum, value) => sum + value, 0);
      if (!total) break;
      const allocations = capacity.map(value => Math.min(value, Math.floor((remaining * value) / total)));
      let allocated = allocations.reduce((sum, value) => sum + value, 0);
      let progressed = true;
      while (allocated < remaining && progressed) {
        progressed = false;
        for (let index = 0; index < blocks.length && allocated < remaining; index += 1) {
          if (capacity[index] > allocations[index]) { allocations[index] += 1; allocated += 1; progressed = true; }
        }
      }
      if (!allocated) break;
      allocations.forEach((minutes, index) => { blocks[index].proposedMinutes -= minutes; });
      remaining -= allocated;
    }
  }

  const recoveredMinutes = blocks.reduce((sum, block) => sum + Math.max(0, block.originalMinutes - block.proposedMinutes), 0);
  return {
    blocks,
    targetRecoveryMinutes: target,
    recoveredMinutes,
    unrecoveredMinutes: Math.max(0, target - recoveredMinutes),
    deltaMinutes: blocks.reduce((sum, block) => sum + block.proposedMinutes - block.originalMinutes, 0),
  };
}

module.exports = { buildTimingPreview };
