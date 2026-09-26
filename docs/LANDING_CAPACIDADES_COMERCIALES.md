# Catálogo comercial de T-Show

Documento interno para revisar las afirmaciones de la landing. La página solo debe anunciar como disponible una capacidad cuyo recorrido visible, permisos y respuesta del backend hayan sido comprobados en un evento ficticio.

## Posicionamiento aprobado

**Promesa:** T-Show reúne la pauta, la preparación y la operación del equipo en una misma referencia.

**Audiencia principal:** productoras, equipos técnicos y organizaciones que coordinan conciertos, festivales, ceremonias o eventos corporativos.

**Conversión principal:** contratar Pro. Conversión secundaria: crear una cuenta o contactar ventas.

## Capacidades y mensaje

| Grupo | Capacidad | Problema que resuelve | Mensaje aprobado | Comprobación requerida |
| --- | --- | --- | --- | --- |
| Preparar | Escaleta, horarios y guion | La pauta está repartida o cambia sin contexto | Ordena bloques, horarios, guion e indicaciones antes de compartir el evento. | Crear, editar y guardar un evento ficticio. |
| Preparar | Áreas y responsables | No está claro quién prepara cada parte | Organiza áreas y deja claro quién está a cargo. | Crear área, asignar responsable y comprobar permisos. |
| Preparar | Checklist | Pendientes dispersos antes de abrir puertas | Revisa pendientes por área y detecta problemas antes del show. | Completar, reabrir y bloquear una tarea. |
| Preparar | Indicaciones técnicas | Las instrucciones no están junto al bloque | Guarda indicaciones junto al momento exacto en que deben ejecutarse. | Crear, editar y verificar asociación estable al bloque. |
| Preparar | Artistas y presentaciones | Convocatorias y camarines se siguen por mensajes | Consulta convocatorias, camarines y estado de cada presentación. | Probar una presentación con estados independientes. |
| Coordinar | Chat interno | Conversaciones del equipo sin referencia común | Conversa por evento con autor, hora y bloque opcional. | Dos miembros reciben mensajes; observador QR queda fuera. |
| Coordinar | Avisos | Una instrucción importante se pierde | Envía a personas, áreas o equipo y confirma su recepción. | Distinguir lectura de confirmación y probar revocación. |
| Operar | Operación en vivo | Cada área mira una versión distinta | Sigue el bloque actual y la siguiente referencia desde una pantalla autorizada. | Probar modo manual, horario, pausa y reconexión. |
| Operar | Escenario y camarines | El equipo necesita una lectura más simple | Consulta el momento actual, anterior, siguiente y pendientes. | Revisar primer, intermedio y último bloque. |
| Anticipar | Ensayo aislado | Practicar puede afectar el evento real | Practica avances y pausas sin afectar la ejecución real. | Confirmar aislamiento de sesión, avisos y contadores. |
| Anticipar | Ajustes de atraso | Aplicar un cambio sin conocer su impacto | Simula los bloques afectados antes de aplicar un ajuste. | Vista previa versionada y rechazo de cambios obsoletos. |
| Anticipar | Consulta sin conexión | La red puede fallar durante una consulta | Conserva la última pauta confirmada para lectura. | Confirmar que no permita enviar ni operar offline. |
| Complemento | PASSLINK | Boletaje y operación están desconectados | Consulta métricas del evento conectado desde T-Show Pro o superior. | Verificar conexión y que la venta siga en PASSLINK. |

## Límites que deben conservarse

- El chat y los avisos son internos; los observadores externos por QR no los reciben.
- Confirmar recibido no significa completar una tarea.
- La consulta sin conexión es de solo lectura; cambios compartidos requieren reconexión.
- Ensayos y simulaciones no modifican automáticamente la ejecución real.
- PASSLINK se contrata por separado; T-Show consulta sus métricas cuando la conexión está habilitada.
- No usar testimonios, cifras de rendimiento, nombres de clientes o etiquetas de plan que no tengan evidencia.
- No anunciar funciones restringidas a eventos piloto como capacidades generales.

## Flujo comercial de referencia

1. El visitante entiende el problema: información repartida y equipo desalineado.
2. Ve preparación por áreas y la operación en vivo con datos de demostración.
3. Comprende el rol del chat y los avisos sin confundirlos con la pauta.
4. Revisa los límites y el precio real del plan Pro.
5. Entra a `billing.html?plan=pro&interval=month` o cambia a anual desde el selector.

La disponibilidad de pago se verifica en el flujo seguro existente. La landing no activa pagos, no confirma cobros y no modifica precios ni permisos.
