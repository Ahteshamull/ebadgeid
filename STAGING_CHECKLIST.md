# Checklist de staging y salida a producción

## Antes de levantar servicios

1. Ejecute `node scripts/bootstrap-env.js` en una copia limpia y complete URLs HTTPS, SMTP y dominios permitidos.
2. Genere `secrets/mongo-keyfile` con permisos `0400`; no lo agregue a Git.
3. Defina `LMS_SYNC_ALLOWED_HOSTS` únicamente con dominios controlados por el LMS.
4. Ejecute el preflight cargando ambos archivos de entorno:

```bash
set -a
. ./.env
. "backend (updated)/.env"
set +a
node scripts/preflight-production.js
```

## Despliegue de staging

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
docker compose ps
```

Confirme `/health` de API, storage, certificate y helpdesk antes de probar flujos de negocio.

## Pruebas obligatorias

- Crear usuario/organización de prueba y autenticar como admin y usuario.
- Cargar imagen y emitir, verificar, revocar y reclamar una credencial.
- Crear contrato, invitar participante, firmar y descargar el PDF con sesión autorizada; comprobar que la URL directa sin sesión devuelve 401/403.
- Ejecutar una compra sandbox. El retorno web debe quedar en `awaiting_verification`, nunca provisionar por sí solo. Un `platform_admin` compara la operación en el panel de Tilopay y la aprueba o rechaza desde `/platform/payments` (ver PRODUCTION_RUNBOOK.md sección 3.f) — verificado en vivo con el flujo completo (aprobar provisiona la organización real; rechazar la marca failed sin provisionar nada).
- Confirmar que un segundo alta de pago pendiente puede coexistir con el primero (regresión real encontrada y corregida esta ronda — ver PRODUCTION_RUNBOOK.md 3.f, índice `stripe_session_id_1`).
- Enviar invitación, activación, credencial y contrato al buzón SMTP de staging y confirmar recepción.
- Configurar un LMS sandbox permitido y comprobar webhook/pull sync sin duplicar credenciales.
- Ejecutar `scripts/backup-stack.sh`, restaurar en stack aislado con `scripts/restore-stack.sh` y repetir health/login/verificación de credencial.

## Criterio de salida

No habilite planes pagados automáticos hasta recibir de Tilopay y probar en sandbox un mecanismo autenticado de confirmación. La aprobación manual incluida es para un piloto supervisado, no reemplaza esa integración.
