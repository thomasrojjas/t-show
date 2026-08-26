-- ============================================================
-- T-Show — permisos del backend para Supabase Data API
-- Ejecutar una vez después de 001_init.sql.
--
-- Las tablas no se exponen automáticamente a roles cliente.
-- Solo el backend, mediante la service_role key, recibe permisos.
-- ============================================================

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- Aplica el mismo criterio a tablas y secuencias futuras creadas
-- por el propietario actual de la base de datos.
alter default privileges in schema public
  grant all privileges on tables to service_role;

alter default privileges in schema public
  grant all privileges on sequences to service_role;
