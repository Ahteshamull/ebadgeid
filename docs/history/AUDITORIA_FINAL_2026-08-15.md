# Auditoría final ejecutada — eBadge ID

Fecha: 2026-08-15  
Alcance: API principal, API helpdesk, tres aplicaciones Next.js, almacenamiento, certificados, MongoDB/Redis, Compose, migraciones y CI.

## Resultado ejecutivo

Se corrigieron los bloqueantes técnicos identificables sin acceso a infraestructura externa. El código queda en **GO para staging controlado** y **NO-GO temporal para producción** hasta superar los gates externos de `PRODUCTION_RUNBOOK.md`.

## Correcciones críticas verificadas

- API keys y tokens de contratos almacenados como hash; el secreto se muestra solo al crear/rotar y nunca se serializa desde el modelo.
- Invitaciones con AES-256-GCM, IV aleatorio y autenticación.
- Alta por invitación y creación de organización transaccionales. Se eliminaron contraseñas temporales por email/HTTP y se añadió activación atómica de un solo uso.
- Autorización multi-tenant en usuarios, credenciales, metas, puntajes, completions, diseños, organizaciones, contratos, tickets, artículos, FAQs, OTP y WebSocket.
- Rate limiting distribuido/persistente y producción fail-closed.
- Uploads limitados, detectados por bytes reales, con nombres aleatorios, sesión y URLs administradas.
- Certificados por servicio interno autenticado, host permitido, límites de recursos y fuentes locales deterministas.
- Contratos con sesión HttpOnly, permisos centrales, tokens hasheados y firma mediante PDF administrado.
- OTP criptográfico con HMAC, comparación constante, intentos y expiración.
- Dashboard falso reemplazado por agregaciones reales por organización; rutas copiadas sin backend retiradas.
- Artículos en borrador hasta cargar markdown administrado.
- Arranque ordenado, health checks, migraciones idempotentes, Mongo replica set y Redis.
- Imágenes no root y `.dockerignore` por servicio; CI con test, lint, build, auditoría Node/Python y Compose.

## Evidencia local

- 46/46 pruebas automatizadas aprobadas.
- Sintaxis de todos los `.js` y `py_compile` aprobados.
- Smoke test del servicio de certificados aprobado.
- Tres builds de producción aprobados.
- ESLint: cero errores; quedan advertencias no bloqueantes de optimización visual/hooks heredados.
- Auditoría Node: **No known vulnerabilities found** tras corregir PDF.js.
- Auditoría Python: **No known vulnerabilities found** tras actualizar el stack.
- Lockfile pnpm: 938 entradas verificadas por políticas de suministro.
- YAML de Compose y CI válido.

## Límite honesto

Docker no estaba disponible localmente, por lo que no se ejecutaron contenedores. Tampoco hubo Mongo, Redis, DNS/TLS, correo, balanceador, object storage, backups u observabilidad reales. No se declara producción final sin los gates externos.
