const crypto = require('crypto');

const BLOCK_STATUSES = new Set(['pending', 'running', 'completed', 'delayed', 'skipped']);

function blockExternalId(block, index) {
  const value = block?.id ?? block?.itemNum;
  return String(value || `block-${index + 1}`);
}

function normalizeBlock(block = {}, index = 0) {
  return {
    externalId: blockExternalId(block, index),
    position: index,
    type: String(block.type || 'other').trim().slice(0, 80) || 'other',
    title: String(block.title || '').trim().slice(0, 500),
    start: block.start || block.startTime || null,
    duration: Math.max(0, Number.parseInt(block.duration, 10) || 0),
    end: block.end || block.endTime || null,
    status: BLOCK_STATUSES.has(block.status) ? block.status : 'pending',
    notes: String(block.notes || '').trim().slice(0, 4000),
    animatorScript: String(block.animator_script || '').trim().slice(0, 8000)
  };
}

function normalizeBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  const seen = new Set();
  return blocks.map(normalizeBlock).map((block, index) => {
    let externalId = block.externalId;
    while (seen.has(externalId)) externalId = `${block.externalId}-${index + 1}-${crypto.randomUUID().slice(0, 8)}`;
    seen.add(externalId);
    return { ...block, externalId };
  });
}

function normalizedBlockToLegacy(block) {
  return {
    ...(block.metadata || {}),
    id: block.external_id,
    type: block.block_type,
    title: block.title,
    start: block.start_time,
    duration: block.duration_minutes,
    end: block.end_time,
    status: block.status,
    notes: block.notes,
    animator_script: block.animator_script,
    notes_updated_at: block.notes_updated_at,
    notes_updated_by: block.notes_updated_by
  };
}

module.exports = { BLOCK_STATUSES, blockExternalId, normalizeBlock, normalizeBlocks, normalizedBlockToLegacy };
