const { supabase } = require('../supabaseClient');

const PLAN_LIMITS = { free: 1, pro: 20, max: 50, enterprise: null };

async function getEntitlement(accountId, role) {
  if (role === 'platform_admin') return { plan: 'enterprise', limit: null, remaining: null, status: 'active', customLimit: null };
  const { data: profile, error } = await supabase.from('profiles').select('account_plan,custom_project_limit,commercial_status').eq('id', accountId).maybeSingle();
  if (error) throw error;
  const { data: subscriptionRaw } = await supabase.from('tshow_subscriptions').select('status,plan_id,tshow_plans(code,project_limit)').eq('account_id', accountId).maybeSingle();
  const subscription = Array.isArray(subscriptionRaw) ? subscriptionRaw[0] : subscriptionRaw;
  const plan = profile?.account_plan || 'free';
  const limit = profile?.custom_project_limit ?? (PLAN_LIMITS[plan] ?? 1);
  const subscribedPlan = Array.isArray(subscription?.tshow_plans) ? subscription.tshow_plans[0] : subscription?.tshow_plans;
  const effective = subscription?.status === 'active' && subscribedPlan?.project_limit !== undefined
    ? (profile?.custom_project_limit ?? subscribedPlan.project_limit)
    : limit;
  const { count } = await supabase.from('tshow_projects').select('id', { count: 'exact', head: true }).eq('owner_id', accountId).is('deleted_at', null);
  return { plan, limit: effective, remaining: effective === null ? null : Math.max(0, effective - (count || 0)), ownedCount: count || 0, status: profile?.commercial_status || 'free', customLimit: profile?.custom_project_limit ?? null };
}

module.exports = { PLAN_LIMITS, getEntitlement };
