const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const project = { id: 'chat-project', owner_id: 'owner', event_name: 'Evento de prueba', payload: { eventDate: '2026-09-21' }, deleted_at: null };
const messages = [];
let sequence = 0;

class Query {
  constructor(table) { this.table = table; this.filters = []; this.mode = 'select'; this.rows = null; this.options = {}; }
  select(_fields, options = {}) { this.options = options; return this; }
  eq(key, value) { this.filters.push(['eq', key, value]); return this; }
  is(key, value) { this.filters.push(['is', key, value]); return this; }
  gt(key, value) { this.filters.push(['gt', key, value]); return this; }
  lt(key, value) { this.filters.push(['lt', key, value]); return this; }
  neq(key, value) { this.filters.push(['neq', key, value]); return this; }
  order(key, options) { this.orderBy = [key, options]; return this; }
  limit(value) { this.limitValue = value; return this; }
  insert(rows) { this.mode = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows) { this.mode = 'upsert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  async execute() {
    if (this.mode === 'insert') {
      const row = { ...this.rows[0], id: `message-${messages.length + 1}`, created_at: new Date().toISOString() };
      messages.push(row); return { data: row, error: null };
    }
    let data = this.table === 'tshow_projects' ? [project]
      : this.table === 'tshow_project_members' ? [{ project_id: project.id, user_id: 'viewer', role: 'viewer' }, { project_id: project.id, user_id: 'editor', role: 'editor' }]
        : this.table === 'profiles' ? [{ id: 'owner', first_name: 'Dueño', last_name: 'Prueba', role: 'account_owner' }, { id: 'viewer', first_name: 'Solo', last_name: 'Lectura', role: 'collaborator' }, { id: 'editor', first_name: 'Director', last_name: 'Prueba', role: 'collaborator' }, { id: 'admin', first_name: 'Plataforma', last_name: 'Admin', role: 'platform_admin' }]
          : this.table === 'tshow_chat_messages' ? messages.slice()
            : [];
    for (const [operator, key, value] of this.filters) data = data.filter(row => operator === 'eq' ? row[key] === value : operator === 'is' ? row[key] === value : operator === 'gt' ? row[key] > value : operator === 'lt' ? row[key] < value : row[key] !== value);
    if (this.orderBy) { const [key, options] = this.orderBy; data.sort((a, b) => options.ascending ? (a[key] > b[key] ? 1 : -1) : (a[key] < b[key] ? 1 : -1)); }
    if (this.limitValue) data = data.slice(0, this.limitValue);
    if (this.options.head) return { data: null, count: data.length, error: null };
    return { data, error: null };
  }
  async maybeSingle() { const result = await this.execute(); return { data: result.data?.[0] || null, error: null }; }
  async single() { const result = await this.execute(); return { data: Array.isArray(result.data) ? result.data[0] : result.data, error: null }; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

const fake = {
  auth: { getUser: async token => ({ data: { user: ['owner', 'viewer', 'editor', 'admin'].includes(token) ? { id: token, email: `${token}@test.invalid` } : null } }) },
  from(table) { return new Query(table); },
  rpc(name) { assert.equal(name, 'tshow_chat_next_sequence'); sequence += 1; return Promise.resolve({ data: sequence, error: null }); }
};

const supabaseModule = require.resolve('../supabaseClient');
require.cache[supabaseModule] = { id: supabaseModule, filename: supabaseModule, loaded: true, exports: { supabase: fake } };
const router = require('../routes/chat');

test('chat API separates read access, write access and platform admin access', async () => {
  const app = express(); app.use(express.json()); app.use('/api', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/projects/${project.id}/chat`;
  const request = (token, path, options = {}) => fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  try {
    assert.equal((await request(null, '/messages')).status, 401);
    assert.equal((await request('viewer', '/messages')).status, 200);
    assert.equal((await request('viewer', '/messages', { method: 'POST', body: JSON.stringify({ body: 'No puedo escribir', clientMessageId: '11111111-1111-4111-8111-111111111111' }) })).status, 403);
    assert.equal((await request('admin', '/messages')).status, 403, 'platform admin must not inherit event chat access');
    const first = await request('owner', '/messages', { method: 'POST', body: JSON.stringify({ body: 'Cambio de escenario', clientMessageId: '22222222-2222-4222-8222-222222222222' }) });
    assert.equal(first.status, 201);
    const duplicate = await request('owner', '/messages', { method: 'POST', body: JSON.stringify({ body: 'Cambio de escenario', clientMessageId: '22222222-2222-4222-8222-222222222222' }) });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).deduplicated, true);
    assert.equal(messages.length, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
