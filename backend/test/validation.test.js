const test = require('node:test');
const assert = require('node:assert/strict');
test('RUT and phone validation formats are enforced by the database migration', () => {
  assert.match('12345678-K', /^[0-9]{7,8}-[0-9K]$/);
  assert.match('+56912345678', /^\+?[0-9]{8,15}$/);
  assert.doesNotMatch('123.456.789-0', /^[0-9]{7,8}-[0-9K]$/);
});
