# T-Show v1 — runbook de staging y lanzamiento

## Estado de la implementación

Las migraciones `021_release_foundation.sql` y `022_release_operations.sql` completan la base del cierre v1: seguimiento de esquema, flags de módulos, intentos de pago, conciliación, cargas R2 confirmadas, snapshots de Guest Pass, sesiones públicas limitadas, plantillas documentales, transiciones financieras y restauración transaccional con cupo.

Estas migraciones deben probarse primero en un proyecto Supabase de staging. No deben considerarse aplicadas en producción hasta ejecutar `backend/db/verify/verify_release_schema.sql` y guardar el resultado del despliegue.

## Ambientes

| Recurso | Local | Staging | Producción |
|---|---|---|---|
| Frontend | localhost documentado | Vercel Preview | www.t-show.site |
| API | localhost:10000 | Render staging | t-show-api.onrender.com |
| Supabase | proyecto local/staging | proyecto independiente | ffelgmxblrtjtjlroxkn |
| R2 | prefijo local | bucket o prefijo staging | bucket privado productivo |
| Pagos | desactivados | sandbox MP/Flow | desactivados hasta certificación |

Nunca reutilizar `service_role`, secretos de webhook o credenciales R2 entre staging y producción.

## Secuencia de despliegue

1. Respaldar Supabase productivo.
2. Aplicar migraciones pendientes en staging.
3. Ejecutar `backend/db/verify/verify_release_schema.sql`.
4. Probar registro, invitaciones, RLS, cupos, R2 y Guest Pass.
5. Configurar cron cada 15 minutos contra `POST /api/billing/reconcile` con `X-Cron-Secret`.
6. Configurar cron diario contra `POST /api/uploads/cleanup` con el mismo encabezado.
7. Certificar Mercado Pago y Flow en sandbox.
8. Aplicar migraciones en producción durante una ventana controlada.
9. Desplegar Render, revisar `/api/health` y logs por `requestId`.
10. Desplegar Vercel y ejecutar smoke tests.
11. Mantener `PAYMENTS_ENABLED=false` hasta completar la matriz financiera.

## Rollback

- Desactivar el módulo afectado mediante sus flags antes de revertir código.
- Revertir Render/Vercel al despliegue anterior si la API o el shell fallan.
- Las migraciones 021/022 son aditivas. No eliminar sus tablas durante un incidente; dejar de usarlas y restaurar el backend anterior.
- Si falla R2, bloquear nuevas cargas y conservar referencias existentes.
- Si falla Realtime, usar refresco periódico de recuperación.
- Si falla un proveedor de pago, mantener `PAYMENTS_ENABLED=false`.

## Certificación externa pendiente

- Security Advisor y Performance Advisor de Supabase.
- Entrega real de Resend y reputación del dominio.
- CORS y ciclo completo del bucket R2.
- Webhooks, reembolsos y renovaciones sandbox de Mercado Pago.
- Confirmación y conciliación sandbox de Flow.
- Pruebas Safari iOS/iPadOS en dispositivos reales.
- Reclasificación de `t-show.site` en FortiGuard.

