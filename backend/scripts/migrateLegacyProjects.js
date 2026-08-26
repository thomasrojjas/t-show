/* One-time migration of backend/data/projects.json after creating the initial Supabase Auth owner. */
const fs = require('fs'); const path = require('path');
const { supabase } = require('../supabaseClient');
async function main() {
  const email = process.env.LEGACY_OWNER_EMAIL?.toLowerCase();
  if (!email) throw new Error('Define LEGACY_OWNER_EMAIL con el correo del superadministrador de Supabase Auth.');
  const { data: users, error } = await supabase.auth.admin.listUsers(); if (error) throw error;
  const owner = users.users.find(user => user.email?.toLowerCase() === email); if (!owner) throw new Error('No existe ese usuario en Supabase Auth.');
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'projects.json'), 'utf8'));
  await supabase.from('profiles').update({ role: 'platform_admin' }).eq('id', owner.id);
  const rows = Object.values(source).map(payload => ({ owner_id: owner.id, event_name: payload.eventName || 'Proyecto sin nombre', payload }));
  for (const row of rows) {
    const { data: existing } = await supabase.from('tshow_projects').select('id').eq('owner_id', owner.id).eq('event_name', row.event_name).maybeSingle();
    if (!existing) { const { error: insertError } = await supabase.from('tshow_projects').insert(row); if (insertError) throw insertError; }
  }
  console.log(`Migrados ${rows.length} proyectos al usuario ${email}.`);
}
main().catch(error => { console.error(error.message); process.exit(1); });
