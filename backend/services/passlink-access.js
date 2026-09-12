const { supabase } = require('../supabaseClient');
const tiers = {pro:'pro',pro_monthly:'pro',pro_annual:'pro',max:'max',max_monthly:'max',max_annual:'max',enterprise:'enterprise'};
const unavailable = () => Object.assign(new Error('No pudimos comprobar el acceso a PASSLINK. Vuelve a intentar.'), {code:'FEATURE_CHECK_UNAVAILABLE',status:503});
async function read(query) { const result=await query; if(result.error)throw unavailable(); return result.data; }
async function passlinkAllowed(accountId, platformRole) {
  if(platformRole==='platform_admin')return true;
  const override=await read(supabase.from('tshow_account_feature_overrides').select('enabled').eq('account_id',accountId).eq('feature_key','integrations').maybeSingle());
  if(override)return Boolean(override.enabled);
  const profile=await read(supabase.from('profiles').select('account_plan,commercial_status,entitlement_starts_at,entitlement_expires_at').eq('id',accountId).maybeSingle());
  if(!profile)throw unavailable();
  const now=Date.now();
  if(profile.entitlement_starts_at&&!(Date.parse(profile.entitlement_starts_at)<=now))return false;
  if(profile.entitlement_expires_at&&!(Date.parse(profile.entitlement_expires_at)>now))return false;
  const subscription=await read(supabase.from('tshow_subscriptions').select('status,current_period_end,tshow_plans(code)').eq('account_id',accountId).maybeSingle());
  if(subscription){
    const plan=Array.isArray(subscription.tshow_plans)?subscription.tshow_plans[0]:subscription.tshow_plans;
    if(subscription.status!=='active')return false;
    if(subscription.current_period_end&&!(Date.parse(subscription.current_period_end)>now))return false;
    if(!plan)throw unavailable();
    return Boolean(tiers[plan.code]);
  }
  return Boolean(tiers[profile.account_plan]) && !['suspended','expired','cancelled','read_only'].includes(profile.commercial_status);
}
module.exports={passlinkAllowed};
