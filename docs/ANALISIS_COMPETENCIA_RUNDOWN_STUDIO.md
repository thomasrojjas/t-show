# Análisis competitivo — Rundown Studio

> Competidor analizado: [Rundown Studio](https://rundownstudio.app/).
>
> Fecha de revisión: 25 de agosto de 2026. Alcance: información pública del sitio, documentación y páginas de producto. No se evaluó una cuenta autenticada ni se hicieron compras.

## Resumen ejecutivo

Rundown Studio es el competidor de referencia más directo para T-Show: ambos buscan reemplazar planillas por una escaleta/rundown colaborativa que se usa antes y durante una producción en vivo. Su propuesta está madura y enfocada en show callers, productores y equipos broadcast: temporización automática, sincronización en vivo, prompter, invitados, salidas para posiciones de trabajo e integraciones.

T-Show ya coincide con el núcleo de valor —bloques, cálculo de horarios, timeline, modo en vivo y exportación—, pero todavía debe estabilizar identidad, persistencia en nube, colaboración y monetización. La oportunidad no es copiar cada función: es competir con una experiencia más localizada para Chile/LatAm, cobro local, soporte en español y un flujo extremadamente simple para producciones de eventos.

## Auditoría de T-Show — código revisado el 26 de agosto de 2026

Esta sección separa con precisión lo que el repositorio implementa hoy de lo que existe solo como migración, interfaz o plan. No equivale a una prueba de producción.

### Capacidades implementadas en el frontend

| Área | T-Show hoy | Observación competitiva |
| --- | --- | --- |
| Planificación | Evento, convocatoria, apertura de puertas, inicio de show automático/manual, duración y bloques `show`, `animación`, `preparación` y `otro` | Muy alineado con eventos y conciertos; es más específico que un rundown genérico. |
| Edición | Crear, eliminar, reordenar bloques y recalcular horarios | Paridad del núcleo de planificación, aunque aún no hay columnas/celdas libres como las de Rundown Studio. |
| Timeline | Barra temporal y métricas de inicio, término y duración | Fortaleza visual que conviene mantener. |
| Operación en vivo | Iniciar, pausar, detener, reiniciar, TAP para siguiente bloque, extender +2/+5/+10 min, omitir/silenciar, reajustar hora y ver balance | Es la capacidad diferencial más valiosa de T-Show hoy. |
| Pantalla de escenario | Vista de confianza/fullscreen para tiempo y bloques | Base útil para evolucionar a outputs por rol. |
| Entregables | Impresión mediante navegador/PDF y exportación JSON | Falta CSV de entrada/salida y PDFs con opciones por puesto. |
| Resiliencia local | Fallback a `localStorage` para proyectos y sesión en vivo | Útil como contingencia, pero no reemplaza sincronización multiusuario fiable. |

### Capacidades incompletas o no listas para producción

| Área | Estado real | Riesgo / trabajo necesario |
| --- | --- | --- |
| Persistencia | Las rutas activas de proyectos y vivo continúan leyendo/escribiendo `backend/data/*.json`; las tablas Supabase existen como migración pero no son usadas por dichas rutas | En Render el filesystem no es persistencia de producción. Migrar CRUD y live state a Supabase es prioridad P0. |
| Cuentas | Existe login JWT de `username` + PIN y un panel de superadministrador | No existe el registro requerido con nombre, apellido, RUT, correo, teléfono y contraseña. |
| Seguridad de sesión | El frontend guarda access y refresh tokens en `localStorage` | Debe migrarse a refresh token rotativo en cookie `HttpOnly`; evitar exposición ante XSS. |
| Autorización | Hay middleware de JWT/roles y tablas de miembros de proyecto, pero `/api/projects` y `/api/live` activos no los aplican | Los datos de proyectos/sesiones no están aislados por usuario. Debe corregirse antes de abrir cuentas. |
| Roles en vivo | La interfaz muestra PINs de ejemplo para Director/Administrador | No usar PINs ni roles de interfaz como control de acceso real; deben venir del backend. |
| Sincronización | `live-sync.js` hace polling y conserva fallback local; `socket.io` está instalado pero no se inicializa ni utiliza | Implementar Realtime de Supabase o Socket.IO real, con control de concurrencia y presencia. |
| Fotos/archivos | Sin R2 ni modelo operativo de adjuntos | Implementar bucket R2 privado, metadata en Supabase y URLs prefirmadas. |
| Pagos | Sin rutas, tablas operativas ni webhooks de Mercado Pago/Flow | Implementar catálogo, intentos, suscripciones y webhooks idempotentes. |
| Calidad | No hay scripts de test ni lockfile versionado | Añadir pruebas de motor de tiempos, API, webhooks y flujo de autenticación; versionar lockfile. |

### Conclusión del estado de producto

T-Show **sí tiene un MVP funcional de escaleta y ejecución individual/local**, pero todavía **no es un SaaS comercialmente seguro**. El orden correcto es: persistencia y autorización → cuentas → colaboración → pagos → outputs/integraciones. Construir teleprompter o Stream Deck antes de eso ampliaría el producto sin resolver el riesgo de datos y acceso.

## 1. Qué vende Rundown Studio

Su mensaje central es “mantener el show a tiempo” para show callers, productores y equipos de broadcast. Está diseñado para trabajo colaborativo online en producciones y eventos en vivo. Atiende broadcasting, conferencias, eventos corporativos, streaming, esports, iglesias, podcasts/radio y educación. [Producto](https://rundownstudio.app/) · [caso de eventos corporativos](https://rundownstudio.app/corporate-events/)

Su posicionamiento evita competir como una planilla genérica: ofrece una fuente de verdad única para el show, con roles/visibilidad, actualización de tiempos y pantallas especializadas para cada posición.

### Cliente objetivo inferido

| Segmento | Necesidad dominante | Adecuación de Rundown Studio |
| --- | --- | --- |
| Producción profesional recurrente | Escaleta viva, colaboración, control técnico e integración | Muy alta |
| Evento corporativo / agencia | Coordinar cliente, proveedores y presentadores | Muy alta |
| Broadcast / streaming | Cues, prompter, temporizador, control externo | Muy alta |
| Evento único pequeño | Organizar un show sin pagar una suite anual | Alta, por plan por evento |
| Usuario de planillas | Migrar desde CSV sin curva de aprendizaje | Alta |

## 2. Oferta observable

| Área | Capacidades públicas de Rundown Studio | Relevancia para T-Show |
| --- | --- | --- |
| Escaleta | Cues con hora de inicio, duración, título, columnas y celdas; horarios hard/soft; edición por lote | Paridad parcial: T-Show ya modela bloques y cálculo; faltan columnas/cues más flexibles. |
| Tiempo | Recalcula horas futuras cuando cambia una duración; seguimiento del cue activo y auto-scroll | Es el mínimo competitivo de la operación en vivo. |
| Colaboración | Invitados sin límite; enlaces privados; permiso de ver/editar contenido o columnas | Brecha alta: T-Show necesita invitaciones, permisos y sincronización robusta. |
| Ejecución | Vista de lista, cue actual y prompter; temporizadores de cuenta regresiva/ascendente; mensajes a outputs | Diferenciador fuerte para día de show. |
| Contenido | Texto enriquecido, colores, checklists, imágenes, archivos, logo personalizado | R2 habilita una base para fotos/adjuntos, pero falta el producto completo. |
| Reutilización | Plantillas, duplicación de rundown e importación/exportación CSV/PDF | T-Show tiene exportación y modelos iniciales; debe formalizar plantillas e importación. |
| Integraciones | API, actualizaciones SSE, Bitfocus Companion/Buttons, QLab y CSV | Brecha alta para clientes broadcast avanzados; no debe ser el primer lanzamiento. |
| Administración | Equipos, suscripciones, facturas/transacciones | T-Show está comenzando esta capa con Supabase y pagos locales. |

Fuentes de funcionalidades: [documentación](https://rundownstudio.app/docs/), [rundown básico](https://rundownstudio.app/docs/rundown/rundown-basics/), [outputs](https://rundownstudio.app/docs/sharing/output/), [integraciones](https://rundownstudio.app/integrations/).

## 3. Comparación contra el estado actual de T-Show

| Dimensión | T-Show hoy | Rundown Studio | Prioridad |
| --- | --- | --- | --- |
| Construcción de escaleta | Bloques de show/animación/preparación/otro, drag-and-drop, duración y cálculo de hora término | Cues y columnas configurables, edición más general | Alta |
| Cronograma visual | Timeline y métricas de convocatoria, puertas, inicio/fin | Timing automático orientado a cue/show | Mantener: puede ser una fortaleza T-Show. |
| Operación en vivo | Sesión en vivo, control de estado y cambios de bloques en el código base | Seguimiento del cue, auto-scroll, vistas dedicadas y prompter | Alta |
| Colaboración multiusuario | Base de roles y miembros de proyecto recién creada; no estabilizada | Invitados, permisos de columna y sincronización en tiempo real | Crítica |
| Archivos y marca | Sin almacenamiento de fotos productivo | Imágenes, archivos, logos y adjuntos | Media-alta |
| Autenticación y cuentas | JWT/Supabase inicial basado en usuario/PIN | Producto SaaS consolidado | Crítica para comercializar. |
| Pagos | Por implementar; Mercado Pago Bricks + Checkout Pro + Flow | Suscripción/recibos visibles; pagos globales mediante Paddle según FAQ | Crítica para negocio local. |
| Localización Chile | Por definir, pero contará con RUT, teléfono y pasarelas locales | Publicación global en USD, impuestos/VAT europeos visibles | Oportunidad estratégica. |
| API/control de hardware | No existe aún | API, SSE, Companion, QLab | Fase posterior. |

### Matriz de decisión: qué igualar, qué no y qué convertir en ventaja

| Capacidad competidora | Decisión para T-Show | Razón |
| --- | --- | --- |
| Cues/columnas/celdas configurables | Igualar después del MVP comercial | Es esencial para broadcast avanzado, pero no para validar el flujo de evento/concierto. |
| Temporización automática | Mantener y profundizar ya | T-Show ya posee la base y puede especializarla en convocatoria, puertas, artista y cambios. |
| Teleprompter | Fase 3 | Necesario en algunos shows, no en todos; primero outputs de tiempo/estado para escenario. |
| Invitados y permisos granulares | Igualar en Fase 1/2 | Es imprescindible para que una productora invite a cliente, técnico y operador sin compartir cuentas. |
| API pública/WebSocket/Companion/QLab | Fase 3, guiada por entrevistas | Costosa de soportar; no construir integraciones sin demanda comprobada. |
| CSV y plantillas | Fase 2, con foco local | Reduce fricción de adopción desde Excel y permite paquetes de plantillas por tipo de evento. |
| Pago por evento | Validar como posible tercer modelo | El plan Event de Rundown Studio muestra que el segmento compra por proyecto; no reemplaza mensual/anual sin validar mercado. |
| Pasarelas Chile | Convertir en ventaja de lanzamiento | Mercado Pago Bricks, Checkout Pro y Flow, más RUT/CLP, resuelven fricción local que una oferta USD no prioriza. |

## 4. Modelo comercial y referencia de precio

Precios públicos observados en USD, antes de impuestos y sujetos a cambio:

| Plan Rundown Studio | Precio visible | Alcance visible |
| --- | --- | --- |
| Solo | USD 0 | 1 miembro, rundowns limitados, invitados de solo lectura, prompter, API, importación CSV y exportación PDF/CSV |
| Event | Desde USD 25 por evento | Ventana de 10/20 días, 2 miembros, rundowns e invitados con acceso completo |
| Team | USD 600 anual visible | 2 miembros, uso regular, rundowns/invitados completos, prompter, API e importación/exportación |

La página muestra alternancia mensual/anual, pero en la revisión pública solo quedó expuesto el valor anual de USD 600. No se debe copiar montos sin validar mercado, costos de soporte, comisiones de las pasarelas, impuestos y límites de uso. [Precios oficiales](https://rundownstudio.app/#pricing)

### Implicancia para T-Show

La propuesta mensual/anual de T-Show debe complementarse con una decisión comercial: si se atenderán eventos únicos, conviene evaluar después un pase por evento/por días. Es una buena respuesta al mercado de productoras, pero no es requisito para el MVP de suscripción.

## 5. Fortalezas competitivas de Rundown Studio

1. **Producto centrado en operación en vivo.** El flujo no termina al crear una escaleta: acompaña a cada equipo durante el show.
2. **Colaboración de bajo roce.** Enlaces privados, invitados y visibilidad por rol reducen la fricción con proveedores y clientes.
3. **Cobertura de casos de uso.** Su mensaje cubre desde broadcast a eventos corporativos, lo que amplía el mercado.
4. **Ecosistema.** CSV reduce barreras de adopción; API, Companion y QLab elevan la retención del segmento técnico.
5. **Distribución orgánica.** Plantillas y calculadoras gratuitas capturan búsquedas de usuarios que aún trabajan con Excel/Google Sheets.
6. **Pricing pragmático.** Plan gratis y pago por evento disminuyen el riesgo de adopción.

## 6. Debilidades/oportunidades para T-Show

Estas son hipótesis de posicionamiento, no afirmaciones de que Rundown Studio no pueda hacerlo.

| Oportunidad | Por qué importa | Respuesta propuesta de T-Show |
| --- | --- | --- |
| Localización Chile/LatAm | Productoras locales prefieren RUT, CLP, pasarelas conocidas y soporte en español. | Registro con RUT; precios CLP; Mercado Pago y Flow; comprobantes y soporte en español. |
| Flujo de producción latino | La jerga y la secuencia convocatoria → puertas → show son centrales en T-Show. | Convertir convocatoria, puertas, pruebas, artistas, cambios y cierre en plantillas nativas. |
| Simplicidad para evento | El producto debe poder funcionar con pocos clics para un director o productor. | Plantillas por tipo de evento, asistente de creación y una vista de “modo show” clara. |
| Visualización de timing | T-Show ya incorpora barra cronológica y métricas. | Mejorar sin sacrificar legibilidad en dispositivos de producción. |
| Cobro local | USD/tarjeta internacional pueden ser un freno. | Checkout Bricks, Checkout Pro y Flow; plan mensual/anual en moneda local. |
| Soporte cercano | Operaciones en vivo valoran respuesta y onboarding. | Canal de soporte, guía de arranque y acompañamiento comercial local. |

## 7. Brechas que no deben ignorarse

T-Show no está listo para vender hasta cerrar estas brechas:

1. Registro de cuenta completo y seguro (nombre, apellido, RUT, correo, teléfono, contraseña, verificación y recuperación).
2. Persistencia total en Supabase: el código aún conserva almacenamiento JSON heredado para proyectos y sesiones.
3. Autorización por proyecto, invitaciones y sincronización en tiempo real confiable.
4. Estados de suscripción impuestos por webhooks de pago, no por el navegador.
5. Carga de fotos/adjuntos privada con R2 y URLs prefirmadas.
6. Backups, auditoría, observabilidad, manejo de errores y pruebas de show en vivo.

## 8. Estrategia recomendada

### Fase 1 — MVP vendible (paridad de problema, no de todo el producto)

- Estabilizar Supabase, usuarios, JWT y roles.
- Migrar proyectos/sesiones desde JSON a PostgreSQL.
- Entregar escaleta, cálculo automático, timeline, modo en vivo y exportación PDF.
- Añadir invitación por proyecto y permisos `director`/`editor`/`viewer`.
- Implementar planes mensual/anual y Mercado Pago Checkout Bricks en sandbox; luego Checkout Pro y Flow, todos detrás del mismo modelo de suscripción.

### Fase 2 — Ventaja local y colaboración

- Plantillas: concierto, evento corporativo, festival, ceremonia, transmisión y streaming.
- Adjuntos/fotos en R2, comentarios con timecode y enlaces de solo lectura.
- Panel de cuenta, facturas/estado de pago, cancelación y reactivación.
- Sincronización de cambios de sesión en vivo entre colaboradores.

### Fase 3 — Respuesta a la capa profesional

- Vistas por posición: operador, escenario, cliente, presentador y pantalla de cue.
- Temporizadores, alertas y prompter.
- Importación CSV completa y API pública documentada.
- Integraciones priorizadas por entrevistas reales: Companion/Stream Deck, QLab u otras herramientas usadas por clientes objetivo.

## 9. Métricas para saber si la estrategia funciona

| Métrica | Señal deseada |
| --- | --- |
| Activación | Cuenta que crea su primer proyecto y agrega bloques el mismo día |
| Valor | Proyecto que llega a modo en vivo o se exporta |
| Colaboración | Proyecto con al menos una invitación aceptada |
| Conversión | Usuario que inicia checkout y recibe suscripción confirmada por webhook |
| Retención | Cuenta que crea/duplica otro proyecto en el período siguiente |
| Confiabilidad | Cero pérdida/doble activación ante webhook repetido y baja tasa de fallos de sincronización |

## 10. Decisiones inmediatas

- El flujo de Mercado Pago “directo” queda definido como **Checkout Pro**.
- Mantener Checkout Bricks como opción embebida y Flow como alternativa directa, pero con un solo catálogo, orden interna y estado de suscripción.
- No iniciar integraciones de hardware/API antes de tener autenticación, colaboración, Supabase y pagos estables.
- Validar precios y propuesta con 5–10 productoras/directores de show chilenos antes de fijar el catálogo final.
