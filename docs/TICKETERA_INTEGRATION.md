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
4. Habilitar la función `integrations` para la cuenta u organización desde Superadmin.
5. Abrir un proyecto en T-Show y entrar a **Métricas**.
6. Seleccionar el evento correspondiente de Ticketera y pulsar **Conectar**.

Las cifras se consultan al abrir o actualizar la vista. La base de datos de compradores permanece en Ticketera.

Cada proyecto de T-Show puede conectarse con un único evento de Ticketera y cada evento de Ticketera puede pertenecer a un único proyecto de T-Show. Para reasignarlo, primero debe desconectarse del proyecto actual.
