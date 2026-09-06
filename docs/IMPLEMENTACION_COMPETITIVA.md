# Implementación competitiva de T-Show

## Objetivo

Esta fase convierte la base existente en una plataforma multiempresa para producir, administrar y operar eventos y espectáculos. La migración mantiene `tshow_projects.payload` como contrato compatible mientras introduce modelos normalizados y versionados.

## Implementado en código

### Núcleo multiempresa y escaleta profesional

- Organización personal automática para cada cuenta existente o nueva.
- Organización como ámbito de trabajo y facturación.
- Asociación de eventos a una organización.
- Bloques normalizados por evento, con departamento, posición, estado, notas y guion.
- Versiones automáticas de cada documento y restauración protegida.
- Control optimista con `document_version` para detectar ediciones concurrentes.
- Comentarios con código de tiempo y archivos asociados a bloques.
- RLS de lectura por organización, propiedad o membresía.
- Realtime para bloques normalizados.

### ERP de eventos

- Directorios de clientes, recintos y proveedores.
- Presupuesto, contingencia, gastos y estado de pago.
- Cotizaciones con ítems, impuestos y vigencia.
- Contratos asociados al evento y cliente.
- Tareas, responsables, prioridades y vencimientos.
- Calendario de organización y eventos.
- APIs protegidas para consultar y administrar estos registros.

### Trabajo offline y resolución de conflictos

- Operaciones idempotentes por dispositivo y usuario.
- Push/pull incremental por cursor.
- Detección atómica de conflictos usando la versión base.
- Conservación de copia local y copia de servidor para revisión asistida.
- Resolución por versión del servidor, cliente o mezcla manual.

### Integraciones

- Registro de conexiones por organización para calendarios, Slack, Teams, Zapier, Make, n8n, exportación contable y puente local.
- Las tablas solo conservan referencias a secretos; las credenciales reales permanecen fuera de la base expuesta.
- Webhooks salientes con eventos seleccionables, firma por referencia y cola de reintentos idempotente.

## Migraciones

Aplicar en orden:

1. `014_multitenant_production_core.sql`
2. `015_event_erp_core.sql`
3. `016_sync_and_integrations.sql`
4. `017_initial_document_snapshots.sql` (corrección aditiva para proyectos migrados)
5. `018_cover_new_foreign_keys.sql` (índices de cobertura para las claves foráneas nuevas)

La migración 014 materializa los bloques actuales y crea un punto de recuperación. Antes de aplicarla en producción se debe disponer de respaldo y confirmar expresamente la ventana de cambio.

## Endpoints añadidos

- `GET /api/projects/:id/blocks`
- `GET /api/projects/:id/versions`
- `POST /api/projects/:id/versions/:version/restore`
- `GET|POST|PATCH|DELETE /api/organizations/:organizationId/clients`
- `GET|POST|PATCH|DELETE /api/organizations/:organizationId/venues`
- `GET|POST|PATCH|DELETE /api/organizations/:organizationId/suppliers`
- `GET|PUT /api/projects/:id/finance`
- `POST|PATCH /api/projects/:id/expenses`
- `GET|POST /api/projects/:id/quotes`
- `GET|POST /api/projects/:id/contracts`
- `GET|POST|PATCH /api/projects/:id/tasks`
- `GET|POST /api/organizations/:organizationId/calendar-events`
- `GET|POST /api/projects/:id/sync`
- `GET /api/projects/:id/sync/conflicts`
- `POST /api/projects/:id/sync/conflicts/:conflictId/resolve`

## Siguiente fase de producto

Queda por construir la interfaz visual de ERP, el almacenamiento IndexedDB del navegador, la cola de sincronización en el frontend, los conectores OAuth reales, exportadores contables por formato, plantillas sectoriales, onboarding y telemetría de producto. Estas piezas ya cuentan con una base de datos y contratos API compatibles.

## Criterios de despliegue

- Crear respaldo de Supabase antes de la migración 014.
- Aplicar migraciones en un entorno de staging privado.
- Comparar el total de bloques normalizados con los bloques de `payload`.
- Ejecutar Security Advisor y Performance Advisor.
- Desplegar Render solo después de que las tres migraciones finalicen.
- Ejecutar pruebas funcionales con propietario, administrador de organización, Director y Observador.
