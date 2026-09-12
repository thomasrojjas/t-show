# Integración T-Show + Ticketera

La integración es exclusivamente servidor a servidor. T-Show consulta resultados agregados y Ticketera no entrega nombres, RUT, correos, teléfonos ni códigos de entrada.

## Variables

En Render para T-Show:

```env
TICKETERA_API_URL=https://ticketera-6eaz.onrender.com
TICKETERA_API_KEY=<secreto-compartido>
```

En Render para Ticketera:

```env
TICKETERA_TSHOW_API_KEY=<el-mismo-secreto-compartido>
```

Use un valor aleatorio de al menos 32 bytes. Los dos servicios deben recibir exactamente el mismo valor.

## Activación

1. Desplegar Ticketera con su nueva variable.
2. Desplegar T-Show con sus dos variables.
3. Aplicar `backend/db/migrations/023_ticketera_metrics.sql` en Supabase.
4. La conexión PASSLINK se incluye desde Pro (también Max y Empresa), según el plan vigente del propietario del proyecto. Starter no la incluye. Se conservan las excepciones explícitas de `integrations` de Superadmin.
5. Abrir un proyecto en T-Show y entrar a **Métricas**.
6. Seleccionar el evento correspondiente de Ticketera y pulsar **Conectar**.

Las cifras se consultan al abrir o actualizar la vista. La base de datos de compradores permanece en Ticketera.

El catálogo acepta `?project=ID` para resolver membresía y plan del propietario; los clientes anteriores sin ese parámetro conservan la comprobación del plan de su propia cuenta. Las rutas, tablas, claves y códigos internos `ticketera` permanecen estables. Un fallo de consulta de permisos devuelve 503, no una denegación comercial. Cambiar de plan no elimina conexiones.

Cada proyecto de T-Show puede conectarse con un único evento de Ticketera y cada evento de Ticketera puede pertenecer a un único proyecto de T-Show. Para reasignarlo, primero debe desconectarse del proyecto actual.

## Diagnóstico seguro en producción

Desde la consola del backend **T-Show en Render**, con el despliegue actualizado y sus variables ya cargadas:

```sh
node scripts/check-ticketera.cjs
```

El comando consulta el catálogo y las métricas del primer evento disponible sin imprimir nombres, cifras ni claves. Opcionalmente acepta un ID de evento como argumento. No crea conexiones ni actualiza registros de sincronización. No debe ejecutarse inicializando la base de datos de Ticketera.

La salida contiene origen validado, ruta sin identificador, estado HTTP externo, tipo de contenido clasificado, duración y referencia de seguimiento. Catálogo y métricas deben terminar con `success: true`; un catálogo vacío no verifica el endpoint de métricas. Compartir únicamente esta salida, nunca variables ni cabeceras.

Errores: `TICKETERA_NOT_CONFIGURED` / `TICKETERA_INVALID_CONFIG` (503), `TICKETERA_TIMEOUT` (504), `TICKETERA_UNAUTHORIZED`, `TICKETERA_INVALID_RESPONSE` y `TICKETERA_UNAVAILABLE` (502). El límite es 25 segundos, sin reintentos automáticos. Un 401/403 externo indica rechazo de autenticación; un HTML o JSON incompatible no se considera una sincronización correcta. Los estados externos 404, 429 y 5xx quedan identificados en los registros del servidor.

Las variables se configuran únicamente en los backends de Render, no en el frontend de Vercel. La URL debe ser el origen HTTPS, sin `/api`, parámetros o credenciales. No rotar el secreto para diagnosticar. Los cambios necesarios en Ticketera se coordinan con su responsable antes de aplicarlos.
