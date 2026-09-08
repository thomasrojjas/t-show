const { supabase } = require('../supabaseClient');

const ADVANCED_FEATURES = new Set([
  'command_center', 'approvals', 'incidents', 'guest_passes',
  'teleprompter', 'erp', 'advanced_exports', 'integrations'
]);

async function featureEnabled(accountId, featureKey, platformRole) {
  if (!ADVANCED_FEATURES.has(featureKey)) return false;
  if (platformRole === 'platform_admin') return true;
  const { data: override } = await supabase.from('tshow_account_feature_overrides')
    .select('enabled').eq('account_id', accountId).eq('feature_key', featureKey).maybeSingle();
  if (override) return Boolean(override.enabled);
  const { data: profile } = await supabase.from('profiles').select('account_plan').eq('id', accountId).maybeSingle();
  const { data: plan } = await supabase.from('tshow_plans').select('id').eq('code', profile?.account_plan || 'free').limit(1).maybeSingle();
  if (!plan) return false;
  const { data: enabled } = await supabase.from('tshow_plan_features').select('enabled').eq('plan_id', plan.id).eq('feature_key', featureKey).maybeSingle();
  return Boolean(enabled?.enabled);
}

module.exports = { ADVANCED_FEATURES, featureEnabled };
