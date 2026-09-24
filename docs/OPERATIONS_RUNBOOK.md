# Runbook de operaciones

## Despliegue

1. Ejecute instalación con lockfile validado, pruebas y builds en CI.
2. Publique imágenes con etiqueta inmutable y SHA del commit.
3. Aplique variables desde el gestor de secretos, nunca desde archivos incluidos en la imagen.
4. Despliegue primero en staging, ejecute smoke tests y luego promueva la misma imagen.
5. Mantenga la versión anterior disponible para rollback.

## Monitoreo mínimo

- Disponibilidad y latencia p50/p95/p99 por API.
- Tasas 4xx/5xx, rechazos de autenticación y rate limit.
- Conexiones y desconexiones WebSocket.
- Saturación de CPU/memoria, conexiones MongoDB y espacio de almacenamiento.
- Fallos y latencia de correo, IA, Shopify y almacenamiento.
- Edad, profundidad y reintentos de colas cuando se incorpore un broker.

## Incidentes

1. Declare severidad, responsable y canal de coordinación.
2. Contenga: revoque claves/sesiones, limite rutas o revierta despliegue.
3. Preserve logs y evidencia; no modifique datos sin respaldo.
4. Recupere servicio y valide flujos críticos.
5. Documente causa, impacto, línea temporal y acciones preventivas.

## Backups

Implementado: `backend (updated)/services/backupService.js`, job diario `backup-database` en el servicio `cron`. Ver `PRODUCTION_RUNBOOK.md`, sección 3.c, para el detalle completo (qué respalda, dónde queda, cómo se restaura, y qué falta explícitamente: sincronizar a almacenamiento fuera del servidor, decisión de infraestructura de quien opere el VPS real).

- Backups cifrados automáticos de MongoDB (ambas bases) — CERRADO. Almacenamiento (archivos subidos) todavía no tiene backup automático — pendiente, mismo patrón aplicable.
- Retención: 14 días localmente (configurable, un solo valor). Retención diaria/semanal/mensual a más largo plazo depende de a dónde se sincronicen los backups fuera del servidor.
- Prueba de restauración: `scripts/restoreBackupTest.js`, manual y deliberada (no automática) — probada con ejecución real, restaura en bases separadas (`__restore_test`), nunca sobreescribe las reales.
- RPO objetivo con la configuración actual: ~24h (una corrida diaria). RTO depende del tamaño real de los datos al momento del incidente — no medido en este entorno de prueba.

## Rotación de secretos

Rote JWT, cifrado, correo, claves API e integraciones con procedimiento de doble clave cuando sea posible. La rotación de `JWT_SECRET` invalida sesiones; comunique la ventana y verifique logout/login.
