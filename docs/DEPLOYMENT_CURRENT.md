# Operación vigente: staging y producción

Este documento sustituye las instrucciones dispersas para poner en marcha la
versión actual. Los archivos de `docs/history/` son evidencia histórica, no
procedimientos operativos.

## Antes de construir

1. En la raíz, copie `.env.example` como `.env` y use secretos reales. No
   guarde el archivo en Git.
2. Complete las seis URL públicas: `PUBLIC_APP_URL`,
   `PUBLIC_API_BASE_URL`, `PUBLIC_STORAGE_BASE_URL`,
   `PUBLIC_CONTRACT_APP_URL`, `PUBLIC_HELPDESK_API_BASE_URL` (todas HTTPS) y
   `PUBLIC_HELPDESK_WS_URL` (WSS).
3. Para subdominios hermanos, establezca `AUTH_COOKIE_DOMAIN`, por ejemplo
   `.staging.ebadgeid.com`. Complete los `.env` de backend y helpdesk con sus
   secretos de aplicación y con orígenes CORS exactos.
4. Ejecute `node scripts/preflight-production.js`. Debe devolver
   `{"status":"ready"...}`; si no, no construya ni despliegue.

## Bootstrap reproducible de staging

Use un proyecto Compose nuevo, nunca el de producción:

```bash
STAGING_COMPOSE_PROJECT_NAME=ebadgeid_staging_20260827 \
  ./scripts/verify-staging-mongo-bootstrap.sh
```

El comando genera volúmenes nuevos para ese nombre de proyecto y verifica:
Mongo autenticado, replica set `rs0`, usuarios `ebadgeid_app` y
`ebadgeid_helpdesk_app`, migraciones de ambas bases y healthchecks de Mongo,
API, almacenamiento y helpdesk. Revise `docker compose logs` y ejecute los
smoke tests funcionales antes de promover una imagen.

## Archivos y privacidad por tenant

Las subidas nuevas tienen metadatos en `stored_files`, con propietario,
hash, tipo, propósito, visibilidad y borrado lógico. Las URL nuevas usan
`/api/files/:storageKey`: los privados requieren sesión de la misma
organización o firma HMAC breve para el generador de certificados. Los flujos
del editor y configuración solicitan visibilidad privada. Durante la
migración, `ALLOW_LEGACY_PUBLIC_UPLOADS=true` conserva URLs antiguas
`/uploads/*`; páselo a `false` solo después de inventariar y migrar las
referencias heredadas.

## Sesiones y CSRF

La sesión del panel se transmite en cookie `httpOnly`; el cliente no guarda
tokens de sesión en `localStorage`. Las escrituras hechas con esa cookie
requieren el encabezado `X-CSRF-Token`, obtenido de la cookie no sensible
`ebadge_csrf`. `frontend/src/lib/api.js` lo añade automáticamente. La ruta
SAML ACS queda exenta porque recibe un POST de un IdP externo y conserva su
propia validación SAML.

## IA, retención y alertas

El helpdesk persiste costos por sesión y por día en `chat_costs` y
`chat_cost_daily`, siempre separados por `organization_code`. La retención
se configura con `AI_COST_RETENTION_DAYS` (90 por defecto) y
`AI_COST_DAILY_RETENTION_DAYS` (400). Para una alerta diaria por organización
configure `AI_COST_ALERT_THRESHOLD_USD` y `AI_COST_ALERT_WEBHOOK_URL`.

## Tests en AMD64 y ARM64

Antes de ejecutar las suites que usan `mongodb-memory-server`, cargue
`source scripts/test-env.sh`. Fija MongoDB 8.0.17 y la distribución
`ubuntu-22.04`, cuyo binario publicado existe para AMD64 y ARM64. La CI usa
los mismos valores para ambas arquitecturas.

## Backup y restauración

Los scripts locales `scripts/backup-stack.sh` y `scripts/restore-stack.sh`
verifican integridad SHA-256; la restauración exige
`RESTORE_CONFIRM=RESTORE_EBADGEID`. La evidencia offsite solo existe cuando
un operador ejecuta una copia contra almacenamiento externo real y conserva
el identificador de objeto, checksum, fecha y resultado de una restauración
en un entorno aislado. No se debe declarar completada antes de esa prueba.
