const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, configuration } = require('../services/ticketera');
const env = { NODE_ENV: 'production', TICKETERA_API_URL: 'https://ticketera.example', TICKETERA_API_KEY: 'private-test-secret' };
const metrics = { issued: 10, checkedIn: 2, grossSalesClp: 20000, approvedTickets: 5,
  pendingPayments: 5, occupancyPercent: 10, capacity: 100, pendingAttendance: 8,
  ticketTypes: [{ name: 'General', issued: 10 }], zones: [{ zone: 'A', count: 2 }] };
const json = (body, status=200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('configuration validates base URL without exposing credentials', () => {
  for(const base of ['http://ticketera.example', 'https://user:secret@ticketera.example',
    'https://ticketera.example/api', 'https://ticketera.example/?secret=x', 'https://ticketera.example/#x', 'invalid']) {
    assert.throws(() => configuration({ ...env, TICKETERA_API_URL: base }), { code: 'TICKETERA_INVALID_CONFIG', status: 503 });
  }
  assert.throws(() => configuration({}), { code: 'TICKETERA_NOT_CONFIGURED', status: 503 });
  assert.equal(configuration(env).base, env.TICKETERA_API_URL);
});

test('catalog and metrics preserve successful contracts, including empty catalog and zero metrics', async () => {
  for (const payload of [{ events: [] }, { success: true, events: [{ id: '1', name: 'Event', date: null }] }]) {
    const client = createClient({ env, logger: () => {}, fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer ' + env.TICKETERA_API_KEY);
      assert.equal(options.redirect, 'error');
      return json(payload);
    }});
    assert.deepEqual(await client.events(), payload);
  }
  const client = createClient({ env, logger: () => {}, fetchImpl: async () => json({ metrics }) });
  assert.deepEqual((await client.metrics('1')).metrics, metrics);
});

test('HTTP errors and invalid payloads are distinct and sanitized', async () => {
  const cases = [
    ...[401,403,404,429,500,502].map(status => [() => json({ error: 'private-test-secret upstream stack' },status),
      [401,403].includes(status) ? 'TICKETERA_UNAUTHORIZED' : 'TICKETERA_UNAVAILABLE', 'events']),
    [() => new Response('<html>private-test-secret</html>', {headers:{'content-type':'text/html'}}), 'TICKETERA_INVALID_RESPONSE', 'events'],
    [() => new Response('{broken', {headers:{'content-type':'application/json'}}), 'TICKETERA_INVALID_RESPONSE', 'events'],
    [() => json({}), 'TICKETERA_INVALID_RESPONSE', 'events'],
    [() => json({success:false,events:[]}), 'TICKETERA_INVALID_RESPONSE', 'events'],
    [() => json({events:[{id:'1'}]}), 'TICKETERA_INVALID_RESPONSE', 'events'],
    [() => json({metrics:{...metrics,issued:'10'}}), 'TICKETERA_INVALID_RESPONSE', 'metrics'],
    [() => json({metrics:{...metrics,zones:null}}), 'TICKETERA_INVALID_RESPONSE', 'metrics'],
    [() => json({metrics:{...metrics,grossSalesClp:-1}}), 'TICKETERA_INVALID_RESPONSE', 'metrics'],
    [() => { throw new Error('private-test-secret network error'); }, 'TICKETERA_UNAVAILABLE', 'events']
  ];
  for(const [response, code, kind] of cases) {
    const logs=[];
    const client=createClient({env,fetchImpl:async()=>response(),logger:record=>logs.push(record)});
    await assert.rejects(kind==='events'?client.events('qa'):client.metrics('1','qa'), error => {
      assert.equal(error.code,code);assert.equal(error.status,502);
      assert.ok(!error.message.includes('private-test-secret'));return true;
    });
    assert.equal(logs[0].requestId,'qa');
    assert.ok(!JSON.stringify(logs).includes('private-test-secret'));
  }
});

test('timeout yields 504 without retrying and covers slow response bodies', async () => {
  for(const slowBody of [false,true]) {
    let calls=0;
    const client=createClient({env,timeoutMs:5,logger:()=>{},fetchImpl:async (url,{signal})=>{
      calls++;
      const wait=()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
      return slowBody ? {status:200,ok:true,headers:new Headers({'content-type':'application/json'}),json:wait} : wait();
    }});
    await assert.rejects(client.events(),{code:'TICKETERA_TIMEOUT',status:504});
    assert.equal(calls,1);
  }
});
