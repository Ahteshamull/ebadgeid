# Runbook de producción — eBadge ID

Este documento es la referencia operativa vigente. Para el estado técnico actual del proyecto (qué se auditó, qué se corrigió, qué queda pendiente y por qué) consulte **`AUDIT_FIXES.md`** en la raíz — es la única fuente que se actualiza en cada ronda. Los informes puntuales de rondas anteriores viven en `docs/history/` y no representan el estado actual.

## 1. Preparación segura

Requisitos: Node.js 22, Python 3.13, Docker Engine con Compose v2, MongoDB 7 como replica set, Redis 7 y dominios HTTPS para app, contratos, helpdesk, API y almacenamiento.

1. Ejecute `node scripts/bootstrap-env.js` una sola vez para crear archivos locales con permisos `0600` y secretos distintos para cada dominio.
2. Complete `backend (updated)/.env` y `help_backend/.env`. En producción establezca `NODE_ENV=production`; no use valores `replace-with-*`.
3. Configure `ALLOWED_ORIGINS` con los tres orígenes web exactos, sin comodines.
4. Configure `PUBLIC_STORAGE_BASE_URL`, `PUBLIC_APP_URL` y `CONTRACT_APP_URL` con HTTPS. Las URL internas permanecen en la red privada de Compose.
5. Configure `EMAIL_USER`/`EMAIL_PASS` con la casilla SMTP real que envía todo el correo saliente (hoy `info@ebadgeid.com`, decisión confirmada por el propietario del producto — no hay proveedor de terceros, Resend se eliminó por completo). `HELPDESK_JWT_SECRET` del backend principal debe ser exactamente el `JWT_SECRET` del helpdesk para que almacenamiento valide ambos dominios de sesión.
6. Guarde secretos en el administrador de secretos de la plataforma, no en Git, imágenes, argumentos de build ni tickets.

## 1.b Autenticación de MongoDB (obligatoria desde la auditoría de seguridad de esta ronda)

MongoDB corría sin `--auth` — verificado con ejecución real: cualquier contenedor de la misma red de Docker, sin ninguna credencial, podía conectarse y leer o escribir las dos bases (`ebadgeid`, `ebadgeid_helpdesk`) por completo. `docker-compose.yml` ahora exige `--auth --keyFile` en el servicio `mongo`, con 4 usuarios de mínimo privilegio (`root` solo para administración; `ebadgeid_app` con `readWrite` únicamente sobre `ebadgeid`; `ebadgeid_helpdesk_app` con `readWrite` únicamente sobre `ebadgeid_helpdesk`; `backup_reader` con `read` únicamente, sobre ambas bases, para el job de backups — ver 3.c).

**En un despliegue nuevo desde cero** (volumen de Mongo vacío): totalmente automático, sin editar `docker-compose.yml` ni crear usuarios a mano (hallazgo CRIT-01 de una auditoría posterior — el procedimiento manual que documentaba esta sección antes contradecía la recuperación repetible, y de hecho dejaba el healthcheck bloqueado para siempre si se omitía un paso).

1. Genere el keyfile una sola vez y guárdelo en el gestor de secretos de la plataforma, nunca en Git ni en la imagen: `openssl rand -base64 756 > secrets/mongo-keyfile && chmod 400 secrets/mongo-keyfile`.
2. Cree `MONGO_ROOT_PASSWORD`, `MONGO_APP_PASSWORD`, `MONGO_HELPDESK_APP_PASSWORD` y `MONGO_BACKUP_PASSWORD` en el `.env` de la raíz (mismo nivel que `docker-compose.yml`) — contraseñas fuertes y distintas, nunca reutilizadas de otro sistema.
3. `docker compose up -d` (o solo `mongo mongo-init` primero, si prefiere verificarlo por separado). Eso es todo.

Por qué funciona sin pasos manuales: el servicio `mongo` ahora invoca explícitamente `docker-entrypoint.sh` (antes se llamaba a `mongod` directo, saltándose el bootstrap propio de la imagen oficial) y declara `MONGO_INITDB_ROOT_USERNAME`/`MONGO_INITDB_ROOT_PASSWORD`. En un volumen realmente vacío, el entrypoint arranca una instancia temporal solo-loopback (sin `--auth` ni `--replSet` todavía), crea el usuario root ahí, corre `scripts/mongo-init-users.js` (montado en `/docker-entrypoint-initdb.d/`, ya estaba escrito para esta convención, solo faltaba conectarlo) para crear los 3 usuarios de aplicación, apaga esa instancia temporal, y recién ahí arranca la instancia real y expuesta en red con `--auth --keyFile --replSet` de siempre. En un volumen que ya tiene estos usuarios (cualquier despliegue existente), este bootstrap es un no-op seguro — nunca se ejecuta contra datos ya inicializados.

Verificado con ejecución real, en un volumen genuinamente vacío, sin ningún paso manual: `docker compose up -d mongo mongo-init` llega a `mongo` healthy y `mongo-init` completa `rs.initiate()` con éxito; los 4 usuarios (`root`, `ebadgeid_app`, `ebadgeid_helpdesk_app`, `backup_reader`) autentican correctamente después; una lectura sin autenticar contra datos reales sigue rechazándose (`Command find requires authentication`) — el nivel de seguridad no cambió, solo se automatizó el arranque.

## 2. Preflight obligatorio

El gestor de paquetes real de este proyecto es **npm** — es el que usan los 5 `Dockerfile` (`COPY
package.json package-lock.json` + `RUN npm ci`) y `.github/workflows/ci.yml`. Una ronda anterior
de la auditoría eliminó el `pnpm-workspace.yaml`/`pnpm-lock.yaml` que existía en la raíz (mecanismo
secundario, nunca el instalador real) por quedar sin uso — no vuelva a agregarlo sin una razón real,
para no reintroducir dos fuentes de verdad sobre qué versión de cada dependencia corre en producción.

```text
for svc in "backend (updated)" help_backend frontend helpdesk_frontend contract; do
  (cd "$svc" && npm ci --no-audit --no-fund && npm audit --omit=dev && npm test)
done
python -m pip install -r "backend (updated)/requirements-certificate.txt" pip-audit
pip-audit -r "backend (updated)/requirements-certificate.txt"
docker compose config --quiet
```

Los tres frontends deben completar además `npm run lint` y `npm run build`. La CI ejecuta estos controles, tests, auditorías Node/Python y validación de Compose.

## 3. Despliegue

1. Haga backup consistente de Mongo y del volumen `uploads_data`.
2. **Ejecute el preflight antes de construir nada** (hallazgo CRIT-02 de una auditoría posterior): cargue tanto el `.env` raíz como `backend (updated)/.env` reales del entorno de destino en el shell (`set -a; source ./.env; source "./backend (updated)/.env"; set +a`, igual que hace `scripts/verify-staging-mongo-bootstrap.sh`) y luego ejecute `node scripts/preflight-production.js`. Sale con código 1 y lista exactamente qué falta/es débil/sigue en `http://localhost` si algo no está listo — nunca construya ni despliegue si este paso falla. Este es el mismo chequeo que antes solo se descubría cuando la API ya había arrancado y se caía (`CONTRACT_APP_URL` u otra URL pública en `http://localhost`) — ahora es una falla clara, de un solo paso, antes de gastar tiempo en build.
3. Construya imágenes inmutables y etiquételas con el SHA del commit.
4. Ejecute primero `mongo`, `mongo-init` y `redis`.
5. Ejecute `migrate` y `help-migrate`; son idempotentes y registran cada migración en `schema_migrations`.
6. Inicie `storage` y `certificate`; espere sus health checks.
7. Inicie `api` y `help-api`; no continúe si `/health` responde distinto de 200.
8. Inicie `app`, `helpdesk` y `contracts`.
9. Ejecute smoke tests reales: login, invitación/alta, upload, emisión/verificación/revocación, creación/firma de contrato, OTP y ticket.

**Nota para pruebas locales en macOS**: el puerto `5000` que `docker-compose.yml` publica para `api` choca con el receptor AirPlay nativo de macOS (proceso `ControlCenter`), que también escucha ahí por defecto. Si `docker compose up` falla con `address already in use` en el puerto 5000 en una Mac, desactive AirPlay Receiver en Ajustes del Sistema → General → AirDrop y Handoff, o remapee el puerto del servicio `api` solo para el entorno local. No aplica a servidores de producción reales.

## 3.b Cron / trabajos programados (servicio `cron`)

El servicio `cron` de `docker-compose.yml` ejecuta cuatro trabajos diarios: notificación de credenciales por vencer, anclaje blockchain diario del día anterior, purga permanente de organizaciones cuya ventana de retención tras un borrado lógico ya expiró (ver más abajo), y backup cifrado de ambas bases de datos (ver 3.c). No es un cron del sistema operativo ni un timer en memoria del proceso — está respaldado por el mismo Redis/BullMQ que ya usa la emisión masiva de credenciales, así que la fuente de verdad de "¿ya corrió esta ocurrencia?" vive en Redis, no en la memoria de un contenedor puntual.

**Purga permanente de organizaciones eliminadas** (job `purge-expired-organizations`, `backend (updated)/services/organizationPurgeService.js`): `DELETE /api/organizations/:id` (hallazgo H-22) solo marca una organización como `status: 'DELETED'` — sus datos se conservan por si hace falta revertir el borrado o auditar. Este job es la otra mitad de esa decisión: una vez pasada la ventana de retención (constante `PURGE_RETENTION_DAYS` en `organizationPurgeService.js`, **90 días** por decisión explícita del propietario del producto), la organización y absolutamente todos sus datos relacionados (usuarios, credenciales, plantillas, contratos, puntajes, notificaciones, API keys, etc. — cada colección que tiene `organization_code`, más las que se derivan de él como Auth/Notifications/ContractAccess) se eliminan para siempre, en una única transacción real de MongoDB: o se borra todo, o no se borra nada. Para cambiar la ventana de retención, es el único valor que hay que tocar. Cada purga real queda registrada como `organization_purged` en los logs del contenedor `cron`, con la cantidad de documentos eliminados por colección — el único rastro que queda, ya que los propios registros de auditoría de esa organización también se eliminan junto con el resto.

**Dónde se configura la frecuencia y cómo cambiarla**: el único lugar es el objeto `SCHEDULE` en `backend (updated)/queues/scheduledJobsQueue.js` (sintaxis cron estándar de 5 campos, evaluada en UTC). Cambiar un valor ahí y desplegar una imagen nueva del servicio `cron` es todo lo que hace falta — `registerSchedules()` corre en cada arranque del servicio y actualiza el horario ya registrado en Redis (`upsertJobScheduler`), nunca crea uno duplicado.

**Sobrevivir reinicios del servidor (VPS)**: dos cosas tienen que estar activas, ninguna es específica de este proyecto:
1. El propio daemon de Docker debe iniciar solo al arrancar el VPS — en la mayoría de distribuciones: `sudo systemctl enable docker`. Sin esto, ni `cron` ni ningún otro servicio de `docker-compose.yml` vuelve a levantarse después de un reinicio del servidor.
2. `restart: unless-stopped` (ya configurado en el servicio `cron`, igual que en `api`) hace que Docker vuelva a levantar el contenedor automáticamente, tanto tras un reinicio del daemon como tras un crash del proceso — a menos que alguien lo haya detenido manualmente con `docker compose stop`.

**Reinicio ante fallos internos (sin caída del contenedor)**: `scripts/cronRunner.js` instala manejadores de `uncaughtException`/`unhandledRejection` que fuerzan `process.exit(1)` — así un error no capturado sí tumba el proceso (y por lo tanto dispara el reinicio de Docker) en vez de dejarlo "vivo" pero inútil. Además, cada ejecución de trabajo individual tiene reintento real con backoff exponencial (3 intentos, ver `defaultJobOptions` en `scheduledJobsQueue.js`) antes de darse por fallida — un fallo transitorio (por ejemplo Mongo momentáneamente inalcanzable) no requiere esperar hasta la próxima ocurrencia diaria.

**Evitar ejecuciones duplicadas**: al estar la programación registrada en Redis (no en memoria de un proceso), es seguro correr más de una réplica del servicio `cron` simultáneamente — BullMQ garantiza que una ocurrencia programada solo la reclama un worker. Probado con un Redis real (no simulado) en `tests/scheduledJobsQueue.integration.test.js`, incluyendo el caso de registrar el horario varias veces seguidas (reinicios, redeploys) sin crear un segundo horario.

**Logs de cada ejecución**: cada corrida real emite `scheduled_job_started` / `scheduled_job_succeeded` / `scheduled_job_failed` en JSON estructurado (`utils/logger.js`) hacia stdout/stderr del contenedor — visibles con `docker compose logs cron` o `docker logs <container>`, igual que el resto de los servicios de este proyecto (no hay un mecanismo de logging especial solo para esto). Los trabajos fallidos y completados quedan además retenidos en Redis (30 días los exitosos, 90 los fallidos) para poder inspeccionar el historial real vía BullMQ, no solo el log de texto.

**Variables de entorno**: el servicio `cron` usa el mismo `backend (updated)/.env` que `api` — en particular `MONGO_URI` (los trabajos escriben en Mongo) y `REDIS_URL` (la programación real). Ningún dato de configuración vive hardcodeado en el código.

## 3.b.1 Cómo corre realmente en el VPS actual (pm2, no Docker)

La sección anterior describe el servicio `cron` de `docker-compose.yml`. El VPS
de producción **no** usa ese stack para el backend: corre bajo pm2, con el
mismo código. Desde el 1 de septiembre de 2026 el planificador está **activo**
allí como proceso `ebadge-cron`:

```
cd /root/ebadgeid-backend-nuevo
pm2 start scripts/cronRunner.js --name ebadge-cron \
  --interpreter /root/.nvm/versions/node/v22.23.2/bin/node --time
pm2 save
```

El intérprete se fija explícitamente en Node 22: con Node 18 la dependencia
`file-type` falla al evaluarse (usa una expresión regular con bandera `v`), y
el proceso no arranca.

`pm2 save` deja el proceso en el volcado que restaura el servicio `pm2-root`
(habilitado en systemd), de modo que sobrevive a un reinicio del servidor. Ese
`pm2 save` es el equivalente aquí de `restart: unless-stopped` en Docker.

**Cinco trabajos, no cuatro** (el runbook anterior enumeraba cuatro): a los ya
descritos se suma `recover-stuck-signups`, cada 15 minutos, que devuelve a la
cola de revisión las altas de pago que quedaron atascadas en `provisioning`.

**Antes de encenderlo por primera vez en un entorno con datos reales**,
conviene comprobar qué haría, porque uno de los trabajos borra datos de forma
permanente:

- `db.organizations.countDocuments({status:"DELETED", deleted_at:{$lte: <hoy menos 90 días>}})`
  debe darte la lista exacta de organizaciones que la purga eliminará.
- `db.credentials.countDocuments({expiration_date:{$gte:new Date(), $lte:<hoy más 30 días>}})`
  te dice a cuánta gente real escribirá el aviso de vencimiento.
- Si `BLOCKCHAIN_RPC_URL` / `BLOCKCHAIN_PRIVATE_KEY` no están configuradas, el
  anclaje se salta solo y lo registra; no lanza error ni gasta fondos.

Para verificar que no solo quedó registrado sino que **ejecuta**, basta esperar
al siguiente cuarto de hora y buscar `scheduled_job_succeeded` en
`pm2 logs ebadge-cron`.

## 3.c Copias de seguridad (backups)

Checklist de salida a producción (`docs/PRODUCTION_CHECKLIST.md`): "MongoDB productivo... backups probados". Antes de esta ronda esto era solo texto en `docs/OPERATIONS_RUNBOOK.md` describiendo la política deseada, sin ninguna implementación real. Ahora hay una real: `backend (updated)/services/backupService.js`.

**Qué hace el backup automático** (job `backup-database`, todos los días a la 1:00 UTC, antes que cualquier otro trabajo toque la base): se conecta con el usuario `backup_reader` (solo `read`, nunca puede escribir — ver 1.b) a ambas bases (`ebadgeid` y `ebadgeid_helpdesk`), vuelca cada colección documento por documento en formato BSON Extended JSON (conserva `ObjectId`/`Date`/etc. correctamente, no es un `JSON.stringify` ingenuo), y cifra cada archivo con AES-256-GCM usando `BACKUP_ENCRYPTION_KEY` (una clave separada de `ENCRYPTION_SECRET` — una clave comprometida para un propósito no debería también desproteger todo el historial de backups). No se usa `mongodump`/`mongorestore`: esas herramientas oficiales no publican binarios para Alpine/musl (la imagen base de este proyecto), y agregar una segunda imagen glibc solo para esto habría sido una dependencia real evitable.

**Dónde quedan los backups**: en el volumen Docker `backups_data` (montado en `/app/backups` dentro del contenedor `cron`), uno por corrida, en una carpeta con timestamp. Se retienen localmente los últimos 14 días (constante `LOCAL_BACKUP_RETENTION_DAYS` en `backupService.js`); los más viejos se borran automáticamente en cada corrida exitosa.

**Lo que falta, explícitamente, y por qué no se hizo acá**: sincronizar estos backups ya cifrados a un almacenamiento fuera del servidor (S3, Backblaze, un bucket propio de operaciones) es una decisión de infraestructura de quien opere el VPS real — no hay ninguna cuenta de almacenamiento externo configurada en este entorno. El archivo que produce cada corrida ya está cifrado en reposo, así que sincronizarlo con `rclone`/`aws s3 sync`/lo que se use no es un problema de seguridad adicional, es un paso de transporte que falta agregar una vez exista esa cuenta.

**Prueba de restauración** (`scripts/restoreBackupTest.js`): deliberadamente NO forma parte del cron automático — igual que pide `docs/OPERATIONS_RUNBOOK.md` ("prueba de restauración trimestral en un entorno aislado"), es una acción manual y deliberada, ejecutada por un operador cuando corresponda:
```
docker compose exec cron node scripts/restoreBackupTest.js
```
Restaura el backup más reciente en bases nuevas con el sufijo `__restore_test` (`ebadgeid__restore_test`, `ebadgeid_helpdesk__restore_test`) usando el usuario `root` — nunca sobreescribe las bases reales, ni siquiera por accidente, salvo que se le pase explícitamente `targetSuffix: ''` desde código. Verificado con ejecución real (`tests/backupRestore.integration.test.js` y una corrida en vivo contra el stack real) que cada documento restaurado es idéntico byte a byte al original, incluyendo tipos sensibles como `Date` y `ObjectId`.

**Variables de entorno nuevas**: `MONGO_BACKUP_PASSWORD` (raíz, usado por `docker-compose.yml` para construir `MONGO_BACKUP_URI`), `BACKUP_ENCRYPTION_KEY` (`backend (updated)/.env`).

**Backup manual de todo el stack** (`scripts/backup-stack.sh` / `scripts/restore-stack.sh`, raíz del proyecto): complementario al job automático de arriba, no un reemplazo — el job automático solo respalda MongoDB (vía `backup_reader`, cifrado, diario, sin intervención humana); estos dos scripts usan `mongodump`/`mongorestore` reales dentro del propio contenedor `mongo` (`docker compose exec -T mongo ...`) y además empaquetan los volúmenes `uploads_data` y `private_contracts_data` completos, pensados para un operador humano antes/después de una migración de servidor o un cambio mayor, no para correr sin supervisión:
```
./scripts/backup-stack.sh                      # produce un tar con Mongo + ambos volúmenes de archivos
RESTORE_CONFIRM=RESTORE_EBADGEID ./scripts/restore-stack.sh <archivo>.tar.gz   # exige la confirmación explícita
```

## 3.d Firma de contratos: almacenamiento privado

`digitalContractController.js`'s `signContract` (hallazgo de la auditoría de esta ronda) exigía antes una URL de archivo firmado servida por el mismo `storage` público que sirve plantillas/imágenes — cualquiera con la URL, sin autenticación, podía descargar el PDF firmado de cualquier contrato. Ahora los PDFs firmados se guardan aparte, en `/app/private-contracts` dentro del contenedor `api` (volumen `private_contracts_data`, permisos `0600` en el archivo), y solo se sirven por `GET /api/contracts/:contract_code/private-files/:filename` — una ruta autenticada que exige `role === 'admin'` o permiso de visualización real sobre ese contrato específico (`req.contractPermissions.view`), nunca acceso público. `signContract` ya no acepta cualquier URL de adjunto: `uploadController.js`'s `isPrivateSignedContractUrl` valida que apunte exactamente a ese contrato antes de aceptarla.

## 3.e Sincronización con LMS: lista blanca de hosts (SSRF)

`PUT /api/lms/config` (`routes/lmsWebhookRoutes.js`) permite que un admin de organización registre la URL de la API de su propio LMS para sincronización periódica (`services/lmsSync.js`, `scripts/syncLms.js`). Esa URL la controla el admin de la organización, no el operador de la plataforma, y se llama desde el servidor por un trabajo programado — sin restricción, un admin malicioso podría apuntarla a servicios internos de la red de Docker (Redis, el puerto interno de `storage`, Mongo) o a un endpoint de metadatos de nube. `utils/lmsSyncUrl.js`'s `validateLmsSyncUrl` exige HTTPS, rechaza literales de IP/`localhost`/credenciales-en-la-URL/puertos no estándar, y además exige que el host coincida con `LMS_SYNC_ALLOWED_HOSTS` (lista separada por comas, admite comodines `*.sufijo`) — configurada como variable de entorno del servicio `api` en `docker-compose.yml`, vacía por defecto (rechaza todo hasta que el operador la complete explícitamente, nunca abre por omisión). Sin configurar esta variable, cualquier intento de un admin de organización de guardar su URL de LMS falla con 400.

## 3.f Alta de organización de pago: verificación manual, no automática

`POST /api/organizations/self-signup` (`services/selfServiceSignup.js`) para un plan gratuito provisiona de inmediato. Para un plan de pago, el cliente pasa por la página de pago hosteada de Tilopay y su navegador vuelve a `GET /api/organizations/self-signup/tilopay-return` — esa vuelta de navegador nunca se trata como comprobante de pago (Tilopay no publica firma criptográfica verificable en ese redirect, ver el comentario de cabecera de `services/tilopayClient.js`), así que **nunca provisiona la organización por sí sola**. Lo único que hace es mover el registro `PendingOrgSignup` a `awaiting_verification` y notificar por correo a `ONBOARDING_NOTIFICATION_EMAIL` (variable opcional; si no está configurada, el registro igual queda visible para revisión manual, solo se salta el correo).

**Cómo se completa un alta de pago real**: un `platform_admin` autenticado confirma la transacción directamente en el panel de Tilopay (monto, moneda, estado de captura) y luego aprueba o rechaza desde `frontend/src/app/platform/payments/page.js` (visible en el sidebar solo para `platform_admin`) — o llamando la API directamente:
```
GET  /api/organizations/self-signup/pending                       # cola de revisión, awaiting_verification
POST /api/organizations/self-signup/pending/:id/approve           # { evidence_reference, verified_amount_cents, verified_currency, note }
POST /api/organizations/self-signup/pending/:id/reject             # { note }
```
`approveSignup` reclama el registro de forma atómica (`findOneAndUpdate` con guarda de estado — dos admins aprobando a la vez nunca provisionan dos veces) y **rechaza la aprobación si el monto/moneda verificados no coinciden exactamente** con lo que se cotizó al cliente al iniciar el alta, devolviendo el registro a `awaiting_verification` en vez de provisionar con datos no verificados. Sin esta cola, un alta de pago quedaría permanentemente varada en `awaiting_verification` — es la mitad que completa la mitigación de seguridad, no solo el bloqueo. El listado incluye el contacto del admin propuesto (nombre/email, nunca el hash de contraseña) para que quien aprueba sepa a quién.

**Bug real encontrado probando la UI en vivo (no leyendo código)**: la colección `pendingorgsignups` conservaba un índice único `stripe_session_id_1` de antes de la migración de Stripe a Tilopay — el campo ya no existe en el esquema actual, pero Mongoose nunca elimina un índice que dejó de declarar, solo agrega los nuevos. Como todo documento sin ese campo comparte el mismo valor `null`, el índice único limitaba la colección a **un solo alta de pago pendiente a la vez**, en cualquier base que viniera de antes de esa migración (una base nueva, con volumen vacío, nunca crea ese índice). Corregido con una migración idempotente (`scripts/migrate.js`, `20260823_drop_stale_stripe_session_id_index`) que elimina el índice si existe — ya aplicada y verificada contra esta base.

## 4. Observabilidad mínima

- Centralice logs JSON y redacte PII en el colector.
- Alerte por health checks, 5xx, latencia p95/p99, Mongo/Redis, email, BullMQ, disco de uploads y errores del generador.
- Retenga auditoría de emisión, revocación, contratos, altas administrativas y migraciones.
- Configure backups cifrados, restauración ensayada y retención.

## 5. Rollback

No revierta migraciones destructivamente. Detenga nuevas escrituras, restaure las imágenes anteriores y conserve los campos nuevos. Si la incidencia afecta datos, restaure Mongo y `uploads_data` desde el mismo punto consistente.

## 6. Gate de salida

La entrega es apta para staging. Producción permanece en `NO-GO` hasta completar en infraestructura real: build/ejecución de imágenes, migración sobre copia anonimizada, E2E con Mongo/Redis/email/almacenamiento, SBOM y escaneo de imágenes, restauración, carga y pentest independiente.
