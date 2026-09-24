# SECURITY AUDIT — eBadge ID

Auditoría OWASP-oriented ejecutada contra el zip entregado. Cada hallazgo indica si fue **VERIFIED** (probado con el servidor corriendo), **VERIFIED (código)** (confirmado leyendo la implementación real, sin ejecución de red posible en este entorno) o **NOT VERIFIED**.

## 1. Broken Access Control / IDOR / Multi-tenancy — **VERIFIED (ejecución real)**

Prueba ejecutada: generé dos JWT válidos con la misma clave del servidor (`organization_code: ORG_A` y `organization_code: ORG_B`), arranqué `backend (updated)` de verdad, y ataqué endpoints reales:

```
Tenant B -> GET /api/organizations/ORG_A/usage        -> 403
Tenant B -> PUT /api/organizations/ORG_A/plan          -> 403
Tenant A -> GET /api/organizations/ORG_A/usage (propio) -> 500 (falla en capa de DB, no en el chequeo de tenant — correcto sin Mongo real)
```

Sin token: **401** en todos los endpoints administrativos probados. Resultado: el middleware `requireOwnOrg` bloquea cross-tenant de verdad, no solo en teoría.

## 2. Authentication — **VERIFIED (código + ejecución parcial)**

- Login: bcrypt para hashing, JWT firmado con secret desde variable de entorno — confirmado, sin secreto hardcodeado en ningún archivo `.js` del repo entregado.
- Cookie httpOnly seteada en el login además del token en el body (`Secure` en producción, `SameSite=Strict`) — confirmado en el código; **no verificado end-to-end en navegador real** (este entorno no tiene uno).
- `/api/auth/logout` limpia la cookie del lado del servidor — probado con `curl`, responde `200` sin necesitar sesión previa.
- Rate limiting específico en `/api/auth` (20 req/15min) además del global — confirmado en `api.js`, no se pudo agotar el límite en esta sesión por tiempo, pero la configuración está presente y aplicada antes del router de auth.

## 3. Secrets Exposure — **VERIFIED**

Rastreo con patrones reales (`re_[A-Za-z0-9_]{15,}`, `sk-...`, `AIza...`, URIs de Mongo con credenciales embebidas) sobre todo el árbol de archivos `.js`/`.env*`, excluyendo `node_modules` y `.env.example`: **0 coincidencias**. Confirmado que no existen archivos `.env` reales en el repo entregado (solo `.env.example` en cada servicio).

## 4. File Upload Security — **VERIFIED (ejecución real, ronda anterior de esta auditoría)**

El endpoint `/api/uploads` valida el tipo de archivo por su **contenido real** (magic bytes vía `file-type`), no por el `Content-Type` que declara el cliente. Prueba histórica documentada en `AUDIT_FIXES.md`: subir un `.txt` con `Content-Type: image/png` mentiroso fue rechazado con `415`. Límite de tamaño (10MB) aplicado vía `multer`. Rate limiting propio en la ruta de upload (30/15min) independiente del global, dado que la conversión de PDF es trabajo real de CPU.

## 5. Rate Limiting — **PARCIAL**

- Global (300/15min) y específico de auth (20/15min): **VERIFIED**, aplicados como middleware de Express antes de los routers.
- Por API key (`requests_allowed_per_minute` del modelo `ApiKey`): **VERIFIED (código)** — implementado con una ventana deslizante en memoria del proceso.
- **Gap real, P2**: el limiter por API key vive en un `Map()` en memoria de un solo proceso Node — se resetea en cada reinicio y **no se comparte entre instancias** si el sistema escala horizontalmente a más de un proceso/contenedor. No es un bug de lógica, es una limitación arquitectónica que un despliegue real con más de una réplica expondría.

## 6. Injection (SQL/NoSQL) — **VERIFIED (código)**

Todo el acceso a datos usa Mongoose con queries parametrizadas por objeto (`Model.findOne({ field: value })`), nunca concatenación de strings hacia consultas. No se encontró ningún uso de `$where` con input de usuario ni construcción dinámica de queries a partir de strings sin sanitizar en los archivos revisados esta ronda.

## 7. XSS — **VERIFIED (código, corregido en ronda previa)**

`helpdesk_frontend` sanitiza con `DOMPurify` antes de cualquier `dangerouslySetInnerHTML` (editor de artículos, vista pública de artículo) — documentado y corregido en `AUDIT_FIXES.md`, no se encontró ningún nuevo punto de inyección de HTML sin sanitizar en esta ronda.

## 8. CORS — **VERIFIED (código)**

Ambos backends usan una whitelist explícita vía `ALLOWED_ORIGINS` en vez de `cors()` abierto — confirmado en `api.js` de ambos servicios.

## 9. Mass Assignment — **VERIFIED (código, corregido en rondas previas)**

`updateOrganization`, `updateUser`, `createUser` filtran explícitamente los campos aceptados desde el body (whitelist), en vez de pasar `req.body` completo a Mongoose — corregido tras encontrarse que permitía escalar de plan gratis a Enterprise y crear usuarios en organizaciones ajenas (ver `AUDIT_FIXES.md`, ronda de límites de plan).

## 10. Lockfiles — **VERIFIED**

Se eliminaron `pnpm-lock.yaml`/`pnpm-workspace.yaml` obsoletos que convivían con `package-lock.json` (npm, el gestor real usado por los Dockerfiles) en `backend (updated)`, `help_backend` y `frontend` — confirmado que estaban hasta 4 días desactualizados y no incluían dependencias reales agregadas después (`multer`, `pdf-to-img`, `file-type`).

## 11. Dependency / Supply Chain — **VERIFIED (ejecución real de `npm audit` en los 5 servicios)**

Esta sección estaba marcada como NOT VERIFIED en la primera versión de este reporte. Se corrigió corriendo `npm audit --omit=dev` real en los 5 servicios, resolviendo cada hallazgo y re-verificando build+tests después de cada cambio.

| Servicio | Vulnerabilidades antes | Después | Críticas resueltas |
|---|---|---|---|
| `backend (updated)` | 16 | **0** | 1 |
| `help_backend` | 20 | **0** | 1 |
| `frontend` | 20 | **0** | 16 |
| `helpdesk_frontend` | 23 | **0** | 16 |
| `contract` | 3 | **0** | 0 |

**Hallazgos de mayor severidad, con evidencia:**

- **CRITICAL — `pdfjs-dist` (RCE)**: la librería usada por `/api/uploads` para convertir PDFs subidos por usuarios a imagen tenía una vulnerabilidad de **ejecución arbitraria de JavaScript al abrir un PDF malicioso** (GHSA-hq66-cqwq-w95j), en el rango exacto de versión instalada. Corregido forzando la versión parcheada vía `overrides` en `package.json` sin bajar `pdf-to-img`. **Re-verificado subiendo un PDF real contra el servidor arrancado**: conversión exitosa a PNG (9320 bytes), sin regresión.
- **CRITICAL — dependencia typo-squat (`sooner` vs `sonner`)**: en `frontend` y `helpdesk_frontend`, el paquete `sooner` (doble "o") estaba declarado como dependencia directa con **cero usos** en el código — el paquete real y usado es `sonner` (bien escrito, 4 referencias confirmadas). `sooner` resultó ser un paquete distinto y abandonado que traía consigo 15-16 de las vulnerabilidades críticas de cada servicio (un toolchain de Babel antiguo empaquetado). Eliminado.
- **CRITICAL — `@xenova/transformers`** (`help_backend`): dependencia de un modelo de ML local, usada **únicamente** por `services/metaAI.js` — el mismo archivo ya identificado como código muerto sin ningún consumidor en el resto del sistema. Se eliminó el archivo y la dependencia juntos.
- **HIGH — `nodemailer`** (ambos backends): múltiples CVE de inyección SMTP/CRLF y SSRF vía la opción `raw`. Actualizado a la versión parcheada en los dos servicios que lo usan para invitaciones/notificaciones/trial.
- **HIGH — `next`/`postcss`/`sharp`** (los 3 frontends): vulnerabilidades dentro del propio árbol de dependencias de Next.js. Corregido subiendo Next.js (15.5.21→16.3.0 en `frontend`/`helpdesk_frontend`; 16.2.11→16.3.0 en `contract`) — **cada upgrade se re-verificó con build de producción real y tests**, no se aplicó a ciegas.
- **HIGH — `jspdf`** (`frontend`, `helpdesk_frontend`): inyección en objetos PDF vía color de `FreeText` e inyección HTML — actualizado a la versión mayor parcheada (3→4), compatible con `jspdf-autotable` ya instalado, re-verificado con build.
- **HIGH — `xlsx`** (los 3 frontends afectados): sin parche disponible del mantenedor (SheetJS) para prototype pollution y ReDoS. **Cero consumidores reales en el código** — eliminado en vez de aceptado como riesgo, ya que no cumplía ninguna función.
- **MODERATE — `react-syntax-highlighter`** (`helpdesk_frontend`): DOM Clobbering vía `prismjs`. Cero consumidores reales — eliminado.

**Efecto colateral positivo**: la limpieza de dependencias sin consumidores (`sooner`, `xlsx`, `html2pdf`, `html2pdf.js`, `react-syntax-highlighter`, `@xenova/transformers`) no solo resolvió vulnerabilidades — también redujo peso muerto real del bundle/instalación, documentado también en `DUPLICATION_DEAD_CODE_REPORT.md`.

**Hallazgo funcional (no solo de seguridad) encontrado en el camino**: la whitelist de dominios de imágenes en `next.config.mjs` (`frontend` y `helpdesk_frontend`) tenía 5-6 dominios de sitios ajenos sin relación con eBadge ID (un diario, un marketplace B2B indio, `marketplace.canva.com`) — y **nunca incluía `api.ebadgeid.com`**, el dominio real donde se sirven las imágenes de plantillas de certificados. Con la validación estricta de dominios de `next/image`, las previsualizaciones de plantillas nunca habrían cargado en producción. Corregido junto con la migración a `remotePatterns` (requerida de todas formas por el upgrade de Next.js 16).

## Resumen de severidad (actualizado)

| Severidad | Cantidad | Detalle |
|---|---|---|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 2 | Rate limiter de API key no distribuido (punto 5); gap de configuración Docker documentado en `DOCKER_INFRASTRUCTURE_AUDIT.md` |
| P3 | 0 | `npm audit` ya ejecutado y resuelto — el punto 3 anterior queda cerrado |

