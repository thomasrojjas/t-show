# Consola en vivo — septiembre 2026

## Diseño

Consola de operación grafito, texto IBM Plex Sans y relojes IBM Plex Mono, servidos localmente.
La escaleta y el monitor/contexto ocupan columnas 55/45 en escritorio; bajo 1100 px se apilan.
Las consultas de contenedor permiten ampliar el contenido sin desbordar la cabecera.
El documento conserva scroll vertical. El seguimiento cambia la selección, nunca fuerza el scroll.
Las fuentes proceden de Fontsource 5.3.0 (@fontsource-variable/ibm-plex-sans y @fontsource/ibm-plex-mono); licencia OFL incluida.

Se aplicaron frontend-design (Anthropic) y web-design-guidelines (Vercel): escala tipográfica acotada,
estados semánticos, foco visible, controles nativos, texto seguro y verificación en navegador.
Referencias: https://docs.getontime.no/ ; https://learn.shoflo.tv/en/articles/1239118-full-screen-timer ;
https://rundownstudio.app/docs/updates/changelog/

## Operación

- Según horario es el modo inicial. Pausa congela la lectura; reanudar recupera la hora original.
- Manual conserva el tiempo transcurrido al cambiar de modo. Admite siguiente, extensión y reinicio de bloque.
- Solo propietario y administrador finalizan/reinician expresamente. El director puede completar el último bloque manual.
- El observador puede consultar y salir. Copiar un enlace nunca concede permisos.
- El balance identifica registros manuales y distingue bloques sin ejecución registrada.
- Se conservan los campos históricos y se usan identificadores estables. Los bloques antiguos sin ID tienen clave por segmento.

## Protocolo y despliegue

Aplicar primero supabase/migrations/20260911144159_live_session_revision.sql.
Añade revision sin modificar los estados existentes. La función de escritura es SECURITY INVOKER,
solo ejecutable por service_role, con bloqueo por proyecto, comparación atómica y auditoría transaccional.

GET /api/projects/:id/live devuelve {data, version, serverNow}.
PUT conserva la ruta y recibe {action, expectedVersion, ...argumentos}; el servidor calcula el nuevo estado.
Acciones: start, pause, resume, mode (mode), next, extend (minutes), restart-block,
exclude/restore (key), finish, reset.
No se admite reemplazar libremente el estado desde el cliente.
El servidor devuelve 409 ante revisiones antiguas o clientes anteriores; 403 ante falta de permisos.
La consola comprueba el protocolo de versión antes de habilitar controles, evitando escrituras
durante un despliegue donde el backend todavía sea antiguo.
La salud pública /api/health indica liveProtocol: 2 y el commit de Render para comprobar el despliegue.

Realtime comunica revisiones; una consulta de salud cada 15 segundos recupera estado y reloj del servidor.
Una escritura fallida exige consultar el resultado antes de repetir. No hay cola de comandos offline.
La política CSP autoriza wss://*.supabase.co además de las conexiones HTTPS.
Para revertir la interfaz puede revertirse el código; no eliminar la columna ni los estados en producción.

## Verificación

- npm test (backend): motor determinista, permisos reales del router y conflictos concurrentes.
- node backend/scripts/verify-live-browser.cjs con Playwright disponible en NODE_PATH.
- --baseline captura la interfaz anterior (7ffae20) con los mismos datos ficticios.
- LIVE_QA_OUTPUT permite elegir directorio de capturas; por defecto se usa el temporal del sistema.
- Las pruebas de navegador interceptan toda API y no escriben en proyectos reales.
- Se probaron seis viewports, 105 bloques, lectura por 31 segundos, pausa/reanudación, manual,
  fallos, conflictos, reinicio, exclusión/restauración, dos ventanas, roles, teclado y zoom.
- La revisión atómica de Postgres se verificó con una transacción revertida, sin persistir cambios de evento.

El código y las pruebas no afirman que los horarios automáticos sean tiempos reales observados.
La vista de escenario y pantalla completa son independientes; salir de la consola no detiene la sesión.
