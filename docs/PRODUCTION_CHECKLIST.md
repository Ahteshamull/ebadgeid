# Checklist de salida a producción

## Obligatorio antes del lanzamiento

- [ ] Regenerar lockfiles con las versiones seguras declaradas y ejecutar instalación limpia.
- [ ] Tests y builds verdes en CI sobre un checkout nuevo.
- [ ] Dominios TLS, DNS y `ALLOWED_ORIGINS` definitivos.
- [ ] Secretos independientes en un secret manager.
- [ ] MongoDB productivo restringido por red e índices comprobados. Backups cifrados automáticos y prueba de restauración: implementados y probados con ejecución real (`services/backupService.js`, `scripts/restoreBackupTest.js`, `PRODUCTION_RUNBOOK.md` sección 3.c) — falta únicamente sincronizarlos a almacenamiento fuera del servidor una vez exista esa cuenta.
- [ ] Almacenamiento privado con URLs firmadas y política de retención.
- [ ] Correo con dominio autenticado (SPF, DKIM, DMARC).
- [ ] Logs centralizados, métricas y alertas con responsables.
- [ ] Pruebas end-to-end, carga, accesibilidad y aislamiento multiempresa.
- [ ] Pentest independiente y corrección de hallazgos críticos/altos.
- [ ] Términos, privacidad, procesamiento de datos y validez contractual revisados legalmente.
- [ ] Runbook, rollback y guardia de incidentes aprobados.

## Integraciones

- [ ] Redis/broker provisionados si se habilitan caché y trabajos asíncronos.
- [ ] SSO probado con tenant de staging y usuarios de cada rol.
- [ ] Cada LMS certificado con sandbox, límites y casos de error.
- [ ] Shopify, IA y correo probados con cuotas y alertas de costo.

## Criterio de go/no-go

No lanzar si existen vulnerabilidades críticas/altas abiertas, restauración no probada, secretos de ejemplo, rutas administrativas sin autorización, builds no reproducibles o integraciones obligatorias sin sandbox validado.
