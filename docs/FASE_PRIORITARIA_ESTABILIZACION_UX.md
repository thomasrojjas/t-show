# Fase inmediata - Estabilización UX de Escaleta y Operación

## Prioridad y alcance

Esta fase se ejecutará antes de continuar con el ERP visual, nuevas integraciones o nuevas funciones comerciales. Su objetivo es corregir los problemas observados en el documento `modificaciones t-show.pdf` y dejar estable la experiencia actual de Escaleta, impresión y operación en vivo.

No modifica el modelo comercial ni incorpora módulos nuevos. Sí puede ajustar el contrato visual y las interacciones existentes, manteniendo permisos, datos y sincronización.

## 1. Densidad y uso del espacio

- Eliminar el espacio superior excesivo entre la navegación y el contenido en Resumen, Escaleta, Guion y las vistas por rol.
- Reducir la altura de los encabezados editoriales dentro del área autenticada.
- Mostrar el primer contenido operativo sin un desplazamiento inicial innecesario.
- Conservar separación suficiente para que la barra fija no cubra títulos ni controles.
- Aplicar el cambio en escritorio, tablet y móvil, considerando `safe-area-inset-*`.

## 2. Tabla de Escaleta

- Corregir la columna de numeración para que admita al menos tres caracteres en una línea, por ejemplo `100`, sin apilarlos verticalmente.
- Definir ancho mínimo estable para número, tipo, inicio, duración y término.
- Permitir que nombres largos utilicen el espacio disponible sin truncarse con `...`.
- Usar ajuste de línea controlado y tamaños tipográficos responsivos cuando el ancho sea limitado.
- Mantener desplazamiento horizontal únicamente dentro del área tabular cuando sea indispensable, nunca en todo el documento.

## 3. Reordenamiento de bloques

- Permitir al propietario y al administrador del proyecto arrastrar bloques para cambiar su orden.
- Incorporar un control de arrastre visible, estados de inicio/destino y confirmación visual al soltar.
- Ofrecer una alternativa accesible mediante teclado y botones `Subir`/`Bajar`.
- Recalcular posiciones, horarios derivados y término del evento después del cambio.
- Persistir el nuevo orden de forma atómica y compatible con `document_version`.
- Revertir visualmente la operación si el guardado falla o existe un conflicto de versión.

## 4. Textos editables de estructura

- Permitir editar las etiquetas descriptivas señaladas en los segmentos de estructura, sin convertir en editables los identificadores internos.
- Cambiar el texto predeterminado `Segmento 1: Convocatoria Comisiones` por `Segmento 1: Convocatoria Staff`.
- Eliminar el texto visible `(AJUSTABLE)` del tercer segmento.
- Mantener valores heredados cuando hayan sido personalizados explícitamente por el usuario.
- Validar longitud, caracteres y contenido vacío antes de guardar.

## 5. Impresión y exportación PDF

- Crear una plantilla de impresión independiente de la interfaz oscura.
- Utilizar fondo blanco, texto negro y alto contraste, sin video, vidrio, sombras ni fondos de color.
- Preparar una versión compacta en orientación horizontal para intentar contener la escaleta completa en una página.
- Reducir tipografía y espacios de manera progresiva según el número de bloques, manteniendo legibilidad mínima.
- Si el contenido no puede caber legiblemente en una sola página, informar al usuario y generar páginas adicionales, evitando recortes o escalado ilegible.
- Incluir nombre del evento, horarios clave, tabla completa, fecha de generación y marca discreta de T-Show/BaseAndes.
- Verificar tanto `window.print()` como exportación PDF del navegador.

## 6. Control de Escenas

- Renombrar la experiencia operativa de `Director` a `Control de Escenas`; el rol interno continúa siendo `editor`.
- Diseñar una vista específica para tablet y pantalla única de continuidad.
- Mostrar simultáneamente, sin scroll principal en tablet horizontal:
  - Estado del evento.
  - Bloque actual y siguiente.
  - Tiempo restante y tiempo transcurrido.
  - Lista compacta de bloques.
  - Controles principales: iniciar, pausar/reanudar, TAP/siguiente bloque, extender y reajustar.
- Mantener acciones secundarias disponibles sin competir con los controles críticos.
- Adaptar la densidad a tablet vertical, horizontal y escritorio.

## 7. Tipografía operativa sin truncamiento

- Eliminar el uso de elipsis en nombres de eventos, bloques y próximos segmentos operativos.
- Usar `clamp()`, ajuste de línea y distribución flexible para conservar el texto completo.
- Reservar una altura máxima solo cuando exista una alternativa explícita para expandir el contenido.
- Verificar nombres extensos en Control de Escenas, Escaleta y Vista de Escenario.

## 8. Vista de Escenario y reloj ampliado

- Mantener la Vista de Escenario como presentación de solo lectura para Observador.
- Añadir en un costado la marca `T-Show desarrollado por BaseAndes.com`, visible pero secundaria.
- Mostrar bloque actual, tiempo restante y próximo bloque con alto contraste y lectura a distancia.
- Permitir que el Observador abra una vista de `Tiempo restante` al hacer doble clic o doble toque accesible sobre el reloj.
- La vista ampliada tendrá salida mediante botón, tecla `Esc` y gesto táctil claro.
- El doble toque no debe provocar zoom accidental en móviles o tablets.

## 9. Corrección de la capa “Extender tiempo”

- Corregir el apilamiento del menú/modal de extensión para que nunca quede detrás del bloque siguiente u otra superficie.
- Revisar `z-index`, contextos creados por `transform`, `filter`, `backdrop-filter` y contenedores con `overflow`.
- Mantener el control visible dentro del viewport y reposicionarlo si no existe espacio inferior.
- Permitir cerrarlo con clic exterior, botón de cierre y `Esc`.
- Verificar foco atrapado, retorno de foco y operación táctil.

## 10. Vistas según rol

- Propietario/administrador: planificación completa, administración y acceso a operación.
- Control de Escenas/Director: consola operativa optimizada para tablet y computador, sin funciones administrativas.
- Observador: Vista de Escenario y Tiempo restante, sin controles de modificación.
- Derivar la vista desde Supabase Auth y la membresía real; no incorporar selectores manuales de rol.
- Validar las restricciones tanto en frontend como en la API existente.

## Orden de ejecución

1. Corregir espacios, tipografía, anchos de Escaleta y truncamientos.
2. Corregir la capa de `Extender tiempo`.
3. Habilitar edición de etiquetas y nuevos textos predeterminados.
4. Implementar reordenamiento accesible y persistente.
5. Construir la plantilla de impresión/PDF.
6. Reestructurar Control de Escenas para tablet y escritorio.
7. Ajustar Vista de Escenario, marca lateral y reloj ampliado.
8. Ejecutar regresión de permisos, sincronización y responsive.

## Criterios de aceptación

- No existe un vacío superior injustificado en ninguna vista autenticada.
- Los números de al menos tres dígitos se muestran horizontalmente en Escaleta.
- Los nombres extensos permanecen completos y no utilizan `...`.
- El propietario puede reordenar bloques con puntero, tacto y teclado.
- El nuevo orden se conserva al recargar y se sincroniza con otra sesión.
- Las etiquetas configurables se editan y persisten; el valor predeterminado usa `Convocatoria Staff` y no muestra `(AJUSTABLE)`.
- La exportación usa fondo blanco y alto contraste; no recorta filas ni columnas.
- Control de Escenas funciona en una sola pantalla a 1024x768 en orientación horizontal.
- Observador no obtiene controles de edición u operación.
- Vista de Escenario contiene la marca solicitada y permite ampliar el reloj.
- `Extender tiempo` permanece por encima de todas las capas y funciona con teclado y tacto.
- Se prueban 390x844, 768x1024, 1024x768, 1366x768 y 1920x1080.
- Se ejecutan pruebas funcionales, `node --check`, `npm test` y `git diff --check`.

## Fuera de esta fase

- Interfaz visual del ERP.
- Conectores OAuth reales.
- Nuevas pasarelas o reglas de pago.
- Nuevos módulos comerciales.
- Nuevas funciones que no sean necesarias para resolver los problemas descritos arriba.

