# Remediación de seguridad — eBadge ID

## Cambios aplicados

- Pagos de alta: `GET /api/organizations/self-signup/tilopay-return` ya no aprovisiona una organización ni acepta `code=1` como prueba de cobro. Un retorno de navegador mueve el registro a `awaiting_verification`; esto evita que una URL forjada cree un tenant de pago.
- Aprovisionamiento: la creación de organización, credencial y perfil de administrador ahora ocurre dentro de una transacción MongoDB. El despliegue usa replica set, requisito necesario para esa garantía atómica.
- Contratos: los PDF firmados se almacenan en `private_contracts_data`, separado de los archivos públicos. Solo `GET /api/contracts/:contract_code/private-files/:filename`, autenticado y autorizado para el contrato, los entrega. No hay ruta estática hacia ese volumen.
- LMS: la URL de sincronización exige HTTPS, hostname sin credenciales ni puerto personalizado, y coincidencia con `LMS_SYNC_ALLOWED_HOSTS`. La comprobación se repite antes de cada llamada saliente.
- MongoDB: el primer arranque de un volumen nuevo utiliza el entrypoint oficial para crear root y los dos usuarios de aplicación; ya no requiere desactivar `--auth` manualmente. `scripts/mongo-init-users.js` se ejecuta solo al inicializar un volumen vacío.
- Piloto de pago: `platform_admin` dispone de una cola de revisión y aprobación manual de altas pagadas. Exige evidencia del procesador, coincidencia exacta de importe/moneda y deja un rastro en `AuditLog`; no confía en un retorno del navegador.
- Operación: se agregaron preflight de secretos/HTTPS/CORS, Compose de staging, scripts explícitos de backup/restauración y `STAGING_CHECKLIST.md`.

## Configuración obligatoria

Defina secretos reales en el `.env` raíz: `MONGO_ROOT_PASSWORD`, `MONGO_APP_PASSWORD` y `MONGO_HELPDESK_APP_PASSWORD`. Mantenga `secrets/mongo-keyfile` fuera de Git.

Para habilitar pull LMS configure, por ejemplo:

```text
LMS_SYNC_ALLOWED_HOSTS=lms.example.edu,*.instructure.com
```

En producción configure `PUBLIC_API_BASE_URL` HTTPS. Es la URL usada para retornos de pago y enlaces privados de PDF.

## Decisión de pagos pendiente

No se implementó una falsa validación de Tilopay. Antes de habilitar la activación automática de planes pagados debe integrarse un mecanismo de confirmación autenticado que Tilopay documente para la cuenta comercial (webhook firmado o consulta servidor-a-servidor de una transacción), verificando al menos referencia, importe, moneda y estado capturado. Hasta entonces, los planes de pago quedan seguros en espera de verificación y deben aprobarse mediante un flujo administrativo controlado.

## Verificación realizada

- Sintaxis de todos los JavaScript del backend: correcta.
- `docker compose config --quiet`: correcta; requiere variables Mongo reales para eliminar sus advertencias.
- Las pruebas de integración requieren MongoDB en memoria. En este entorno no pudieron arrancar: Alpine no tiene binario MongoDB compatible y la imagen Debian compatible no estaba disponible localmente. Este límite no equivale a pruebas aprobadas.
