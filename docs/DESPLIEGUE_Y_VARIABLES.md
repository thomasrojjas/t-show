# Despliegue T-Show

Ejecuta las migraciones SQL en orden: `001_init.sql`, `002_grant_service_role.sql`, `003_saas_core.sql`. Luego crea el primer usuario desde la pantalla de registro y ejecuta una sola vez `node scripts/migrateLegacyProjects.js` en un entorno con `LEGACY_OWNER_EMAIL` configurado.

Supabase debe tener habilitado Email/Password, confirmación de correo y las URL de redirección de Vercel. No expongas nunca la Service Role, claves de pagos ni R2 en Vercel.

La migración `003_saas_core.sql` usa un trigger sobre `auth.users`: el primer registro ya crea su perfil. Para convertir una cuenta en administradora de plataforma, ejecuta una vez en el SQL Editor: `update public.profiles set role = 'platform_admin' where email = '<tu-correo>';`.
