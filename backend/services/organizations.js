const { supabase } = require('../supabaseClient');

async function ensurePersonalOrganization(profile) {
  if (profile.default_organization_id) return profile.default_organization_id;

  const slug = `personal-${String(profile.id).replace(/-/g, '').slice(0, 12)}`;
  let { data: organization, error } = await supabase
    .from('tshow_organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw error;
  if (!organization) {
    const created = await supabase.from('tshow_organizations').insert({
      name: `${profile.first_name} ${profile.last_name}`.trim(),
      slug,
      kind: 'producer',
      created_by: profile.id,
      billing_owner_id: profile.id,
      is_personal: true
    }).select('id').single();
    if (created.error) throw created.error;
    organization = created.data;
  }

  const membership = await supabase.from('tshow_organization_members').upsert({
    organization_id: organization.id,
    user_id: profile.id,
    role: 'owner'
  }, { onConflict: 'organization_id,user_id' });
  if (membership.error) throw membership.error;

  const updated = await supabase.from('profiles').update({ default_organization_id: organization.id }).eq('id', profile.id);
  if (updated.error) throw updated.error;
  return organization.id;
}

async function resolveWritableOrganization(profile, requestedId) {
  const organizationId = requestedId || profile.default_organization_id || await ensurePersonalOrganization(profile);
  if (profile.role === 'platform_admin') return organizationId;
  const { data, error } = await supabase.from('tshow_organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', profile.id)
    .maybeSingle();
  if (error) throw error;
  if (!data || !['owner', 'admin'].includes(data.role)) {
    const accessError = new Error('No tienes permiso para crear proyectos en esta organización.');
    accessError.status = 403;
    throw accessError;
  }
  return organizationId;
}

module.exports = { ensurePersonalOrganization, resolveWritableOrganization };
