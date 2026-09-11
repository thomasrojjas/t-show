const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
let rpcError = null, membershipError = null;
const fake = {
  auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id:'user',email:'USER@example.invalid' } : null } }) },
  rpc: async (name,args) => {
    assert.equal(name,'tshow_accept_invitation_service');
    assert.equal(args.authenticated_email,'user@example.invalid');
    return rpcError ? {error:rpcError} : {data:[{project_id:'shared',member_role:'viewer'}]};
  },
  from(table) {
    const query = {
      select(){return this},eq(){return this},is(){return this},order(){return this},
      maybeSingle: async () => ({data:{id:'user',role:'account_owner'}}),
      then(resolve,reject) {
        return Promise.resolve(table === 'tshow_project_members'
          ? {error:membershipError,data:[{role:'viewer',tshow_projects:{id:'shared'}},{role:'viewer',tshow_projects:{id:'owned'}},{role:'editor',tshow_projects:null}]}
          : {data:[{id:'owned',owner_id:'user'}],count:1}).then(resolve,reject);
      }
    }; return query;
  }
};
for(const [path,exports] of [['../supabaseClient',{supabase:fake}],['../services/entitlements',{getEntitlement:async()=>({limit:1,remaining:0,plan:'free',status:'free'}),PLAN_LIMITS:{}}]]) {
  const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports};
}
const router=require('../routes/saas');
test('invitation errors remain distinct and shared project failures are visible',async()=>{
  const app=express();app.use(express.json());app.use('/api',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port+'/api';
  const accept=(token='valid')=>fetch(base+'/invitations/test-token/accept',{method:'POST',headers:{Authorization:'Bearer '+token}});
  try {
    assert.equal((await accept('invalid')).status,401);
    assert.deepEqual(await (await accept()).json(),{success:true,projectId:'shared',role:'viewer'});
    for(const [reason,status] of [['INVITATION_EMAIL_MISMATCH',403],['PROFILE_NOT_FOUND',403],['INVITATION_EXPIRED',410],['INVITATION_REVOKED',410],['INVITATION_ACCESS_REMOVED',403],['INVITATION_NOT_FOUND',404],['column reference is ambiguous',503]]) {
      rpcError={message:reason,code:'42702'};const response=await accept();const body=await response.json();
      assert.equal(response.status,status);
      assert.equal(body.code,status===503?'INVITATION_SERVICE_ERROR':reason);
      assert.ok(!body.message.includes('ambiguous'));
    }
    const projects=()=>fetch(base+'/projects',{headers:{Authorization:'Bearer valid'}});
    let body=await (await projects()).json();
    assert.deepEqual(body.data.map(p=>[p.id,p.member_role]),[['shared','viewer'],['owned','owner']]);
    assert.equal(body.meta.ownedCount,1);
    membershipError={message:'query failed'};
    assert.equal((await projects()).status,503);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
