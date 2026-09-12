// Run in the T-Show backend environment. No keys or business data are printed.
// Calls Ticketera directly: does not create connections or update sync records.
const { createClient } = require('../services/ticketera');
const { randomUUID } = require('node:crypto');
const client = createClient();
async function main() {
  const requestId = randomUUID();
  const result = await client.events(requestId);
  console.log(JSON.stringify({ check: 'catalog', success: true, eventCount: result.events.length, requestId }));
  const requestedId = process.argv[2];
  const event = requestedId ? result.events.find(item => item.id === requestedId) : result.events[0];
  if (requestedId && !event) throw new Error('El evento solicitado no aparece en el catálogo.');
  if (!event) {
    console.log(JSON.stringify({ check: 'metrics', skipped: true, reason: 'empty_catalog' }));
    return;
  }
  await client.metrics(event.id, requestId);
  console.log(JSON.stringify({ check: 'metrics', success: true, requestId }));
}
main().catch(error => {
  console.error(JSON.stringify({ success: false, code: error.code || 'CHECK_FAILED', message: error.message }));
  process.exitCode = 1;
});
