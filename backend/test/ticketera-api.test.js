const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {requestContext}=require('../lib/http');
let upstreamError=null,saveError=null;
const updates=[];
const connection={id:'connection',project_id:'project',external_event_id:'1',last_synced_at:'2026-01-01T00:00:00Z'};
const fake={from(table){
  return {select(){return this;},eq(){return this;},
    update(row){updates.push(row);return this;},
    maybeSingle:async()=>({data:table==='tshow_projects'?{id:'project',owner_id:'user'}:connection}),
    then(resolve,reject){return Promise.resolve({error:saveError}).then(resolve,reject);}
  };
}};
for(const [path,exports] of [
  ['../supabaseClient',{supabase:fake}],
  ['../middleware/supabaseAuth',{requireSupabaseAuth:(req,res,next)=>{req.user={id:'user',profile:{}};next();}}],
  ['../services/features',{featureEnabled:async()=>true}],
  ['../services/ticketera',{configuration:()=>({}),createClient:()=>({
    events:async()=>{if(upstreamError)throw upstreamError;return {events:[]};},
    metrics:async()=>{if(upstreamError)throw upstreamError;return {metrics:{issued:0}};}
  })}]
]){const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports};}
const router=require('../routes/integrations');
test('integration routes preserve error statuses, request IDs and connection timestamps',async()=>{
  const app=express();app.use(requestContext);app.use(express.json());app.use('/api',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/api';
  const get=path=>fetch(base+path,{headers:{'X-Request-Id':'qa-request-123'}});
  try{
    assert.deepEqual(await (await get('/integrations/ticketera/events')).json(),{success:true,data:[]});
    for(const [code,status] of [['TICKETERA_TIMEOUT',504],['TICKETERA_NOT_CONFIGURED',503],['TICKETERA_INVALID_RESPONSE',502],['TICKETERA_UNAUTHORIZED',502]]){
      upstreamError=Object.assign(new Error('Safe message'),{code,status});
      for(const path of ['/integrations/ticketera/events','/projects/project/metrics/ticketera']){
        const response=await get(path),body=await response.json();
        assert.equal(response.status,status);assert.equal(body.code,code);assert.equal(body.requestId,'qa-request-123');
      }
      assert.equal(updates.at(-1).status,'error');
      assert.equal(updates.at(-1).last_synced_at,undefined);
    }
    assert.equal(connection.last_synced_at,'2026-01-01T00:00:00Z');
    upstreamError=null;
    assert.equal((await get('/projects/project/metrics/ticketera')).status,200);
    assert.equal(updates.at(-1).status,'active');assert.ok(updates.at(-1).last_synced_at);
    saveError={message:'database unavailable'};
    assert.equal((await get('/projects/project/metrics/ticketera')).status,500);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
