# Recordatorios de inicio de eventos

T-Show envía un aviso por correo 15 minutos antes del inicio programado de cada evento. El proceso corre en Render, por lo que no depende de que el navegador esté abierto.

## Qué se considera inicio

Se usa `eventDate` y `showStartTimeInput` del evento (con respaldo en `showStartTime`) en la zona horaria `America/Santiago`. El recordatorio se genera para el propietario y los miembros activos del proyecto.

## Configuración en Render

1. Añade `CRON_SECRET` como secreto aleatorio de al menos 32 caracteres. Debe ser el mismo valor que usará el Cron Job; nunca lo publiques en Vercel ni en el frontend.
2. Confirma que existan `RESEND_API_KEY`, `RESEND_FROM` y `FRONTEND_URL`.
3. Crea un **Cron Job** en Render apuntando al mismo repositorio y región del backend.
4. Programa la ejecución cada minuto (si el plan no lo permite, usa cada 5 minutos y acepta una ventana aproximada).
5. Usa este comando, reemplazando solo el dominio si tu API tiene otro:

```bash
curl -fsS -X POST "https://t-show-api.onrender.com/api/notifications/event-reminders" \
  -H "x-cron-secret: $CRON_SECRET"
```

Configura `CRON_SECRET` como variable secreta del Cron Job, no escrita directamente en el comando.

## Aplicar la migración

Ejecuta `backend/db/migrations/025_event_start_reminders.sql` en el proyecto Supabase productivo mediante el flujo habitual de migraciones. La función `claim_event_start_reminders` crea una marca única por proyecto, inicio y ventana de 15 minutos, evitando duplicados en reintentos o instancias concurrentes.

## Verificación

- Sin `x-cron-secret`, el endpoint responde `401`.
- Con secreto correcto y Resend configurado, responde con la cantidad procesada.
- Un envío exitoso queda como `sent` en `tshow_event_reminders`.
- Un fallo de Resend queda como `failed` y conserva el error técnico resumido para diagnóstico; no se guardan contraseñas, JWT ni tokens de invitación.

El endpoint también acepta `GET` para una comprobación manual, aunque el Cron Job debe usar `POST`.
