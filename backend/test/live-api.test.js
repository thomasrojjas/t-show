const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const project = { id:'qa-project', owner_id:'owner', payload:{eventDate:'2026-09-11',convocatoriaDuration:0,doorsDuration:0,showStartMode:'fixed',showStartTimeInput:'20:00',blocks:[{id:'a',title:'A',type:'SHOW',duration:10}]} };
let session=null;
const fake = {
  auth:{getUser:async token=>({data:{user:['owner','editor','viewer','admin'].includes(token)?{id:token}:null}})},
  from(table) {
    const filters={};
    const query={
      select(){return this;},eq(key,value){filters[key]=value;return this;},is(){return this;},
      async maybeSingle(){
        if(table==='profiles')return {data:{id:filters.id,role:filters.id==='admin'?'platform_admin':'account_owner'}};
        if(table==='tshow_projects')return {data:filters.id===project.id?project:null};
        if(table==='tshow_project_members')return {data:['editor','viewer'].includes(filters.user_id)?{role:filters.user_id}:null};
        if(table==='tshow_live_sessions')return {data:session};
        throw Error('Unexpected query '+table);
      }
    };return query;
  },
  async rpc(name,args){
    assert.equal(name,'tshow_commit_live_session');
    if((session?.revision||0)!==args.expected_revision)return {error:{code:'40001'}};
    session={state:args.next_state,revision:args.expected_revision+1};
    return {data:session};
  }
};
require.cache[require.resolve('../supabaseClient')]={id:require.resolve('../supabaseClient'),filename:require.resolve('../supabaseClient'),loaded:true,exports:{supabase:fake}};
const router=require('../routes/saas');
test('live API authenticates, authorizes transitions, and rejects stale writes',async()=>{
  const app=express();app.use(express.json());app.use('/api',router);
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/api/projects/'+project.id+'/live';
  const request=(role,body)=>fetch(base,{signal:AbortSignal.timeout(5000),method:body?'PUT':'GET',headers:{'Content-Type':'application/json',...(role?{Authorization:'Bearer '+role}:{})},...(body?{body:JSON.stringify(body)}:{})});
  try{
    assert.equal((await request(null)).status,401);
    assert.equal((await request('viewer')).status,200);
    assert.equal((await request('viewer',{action:'start',expectedVersion:0})).status,403);
    assert.equal((await request('owner',{status:'live'})).status,409,'old clients must reload');
    let response=await request('editor',{action:'start',expectedVersion:0});
    assert.equal(response.status,200);assert.equal((await response.json()).version,1);
    assert.equal((await request('editor',{action:'finish',expectedVersion:1})).status,403);
    assert.equal((await request('owner',{action:'pause',expectedVersion:0})).status,409);
    const concurrent=await Promise.all([request('owner',{action:'pause',expectedVersion:1}),request('admin',{action:'pause',expectedVersion:1})]);
    assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);
    assert.equal((await request('editor',{action:'reset',expectedVersion:2})).status,403);
    assert.equal((await request('owner',{action:'finish',expectedVersion:2})).status,200);
    response=await request('viewer');
    const body=await response.json();assert.equal(body.data.status,'finished');assert.equal(body.version,3);
    assert.equal((await request('admin',{action:'reset',expectedVersion:3})).status,200);
    assert.equal(session.state.status,'idle');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
