const test=require('node:test');
const assert=require('node:assert/strict');
let fixtures={},failed=null;
const client={from(table){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:fixtures[table]||null,error:failed===table?{message:'private error'}:null})};}};
const id=require.resolve('../supabaseClient');require.cache[id]={id,filename:id,loaded:true,exports:{supabase:client}};
const {passlinkAllowed}=require('../services/passlink-access');
test('PASSLINK tier, subscriptions, exceptions and recoverable failures',async()=>{
  const set=(plan)=>{fixtures={profiles:{account_plan:plan,commercial_status:'active'}};failed=null;};
  for(const plan of ['free','starter','monthly','annual','unknown']){set(plan);assert.equal(await passlinkAllowed('owner'),false);}
  for(const plan of ['pro','max','enterprise','pro_monthly','pro_annual','max_monthly','max_annual']){
    set(plan);assert.equal(await passlinkAllowed('owner'),true);
    fixtures.profiles.entitlement_expires_at='2000-01-01';assert.equal(await passlinkAllowed('owner'),false);
  }
  for(const plan of ['pro_monthly','pro_annual','max_monthly','max_annual','enterprise']){
    set('free');fixtures.tshow_subscriptions={status:'active',current_period_end:'2099-01-01',tshow_plans:{code:plan}};
    assert.equal(await passlinkAllowed('owner'),true);
    fixtures.tshow_subscriptions.status='cancelled';assert.equal(await passlinkAllowed('owner'),false);
    fixtures.tshow_subscriptions.status='active';fixtures.tshow_subscriptions.current_period_end='2000-01-01';assert.equal(await passlinkAllowed('owner'),false);
  }
  set('free');fixtures.tshow_account_feature_overrides={enabled:true};assert.equal(await passlinkAllowed('owner'),true);
  set('pro');fixtures.tshow_account_feature_overrides={enabled:false};assert.equal(await passlinkAllowed('owner'),false);
  assert.equal(await passlinkAllowed('owner','platform_admin'),true);
  for(const table of ['profiles','tshow_subscriptions','tshow_account_feature_overrides']){
    set('pro');failed=table;await assert.rejects(passlinkAllowed('owner'),{code:'FEATURE_CHECK_UNAVAILABLE',status:503});
  }
});
