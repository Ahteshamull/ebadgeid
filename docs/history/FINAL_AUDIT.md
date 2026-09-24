# FINAL_AUDIT.md — Validación final adversarial (ronda 20, con ejecución real)

> **Actualización posterior (ronda 21)**: los 3 hallazgos de este reporte (condición de carrera del WebSocket — P1, sección 2;
> `docker-compose.yml` sin `NEXT_PUBLIC_ORGANIZATION_CODE` — P2; naming `organization_code`/`organizationCode` inconsistente — P2)
> fueron cerrados y re-verificados con ejecución real (cliente WebSocket real, 3/3 corridas con el mensaje inmediato en `open`
> recibiendo respuesta correcta; suite completa 78 passed/0 failed, sin flakes). De paso se encontró y corrigió un test
> preexistente intermitente (`securityPrimitives.test.js`, sin relación con las rondas 20/21 — ver "Ronda 21" en `AUDIT_FIXES.md`).
>
> **Actualización posterior (ronda 22)**: un segundo spot-check adversarial (el spot-check original de la ronda 20 se había
> perdido por un reinicio de sesión) encontró y cerró 2 hallazgos P3 más: fuga del objeto `Error` crudo al cliente en
> `help_backend/controllers/articleController.js` (5 sitios, confirmado con ejecución real que un `ValidationError` de
> Mongoose sí tiene propiedades enumerables que se filtraban, a diferencia de un `Error` genérico), y accesibilidad
> (nombres accesibles faltantes en el toggle de invitado, sus 5 campos, y los inputs de letter-spacing/line-height del
> editor). Ver "Ronda 22" en `AUDIT_FIXES.md` para el detalle completo.
>
> Este archivo se conserva sin editar su cuerpo (registro de la validación tal como se hizo) — el estado post-fix real
> está en `AUDIT_FIXES.md`. Porcentaje actualizado: **94/100** (ver "Ronda 22").

Fecha: 2026-08-18
Alcance: re-validación del repositorio tras la "Vigésima ronda" (`AUDIT_FIXES.md`) — chat multi-tenant real en `help_backend`, entorno de ejecución de Node.js, y 32 tests nuevos. Misión explícita: **intentar demostrar que la ronda 20 está mal, incompleta, o introdujo regresiones** — no repetir la auditoría histórica de 19 rondas previas ya documentada en `AUDIT_FIXES.md` y en la versión anterior de este mismo archivo (conservada en el historial de git, commit anterior a este).

**Diferencia central con toda auditoría anterior de este proyecto**: por primera vez hay Node.js real disponible (binario portátil v22.14.0, sin tocar el sistema) — así que gran parte de lo que en las 19 rondas previas era "NO VERIFICABLE por entorno" pasa a **VERIFICADO por ejecución real** en esta ronda: build de producción de los 3 Next.js, arranque real de los 2 backends Express contra MongoDB/Redis reales (efímeros, vía `mongodb-memory-server`/`redis-memory-server`), un cliente WebSocket real, y la suite completa de tests.

## 0. Nota metodológica — sustitución de archivos pedidos

Se pidió usar `AUDIT_BASELINE.md` y `REMEDIATION_REPORT.md`. **Ninguno de los dos existe en este repositorio** (igual que en la validación anterior). Se usó como línea base la versión previa de este mismo `FINAL_AUDIT.md` (ronda 19, conservada en el historial de git) + `AUDIT_FIXES.md` completo, y como "remediation report" la sección "Vigésima ronda" de `AUDIT_FIXES.md`, que documenta exactamente qué cambió desde esa línea base.

## 1. Entorno de ejecución de esta validación

- **Node.js v22.14.0** (binario oficial `darwin-arm64`, portátil, sin `sudo`) + `npm install` real en los 5 servicios.
- **MongoDB y Redis reales** (no mocks): `mongodb-memory-server` y `redis-memory-server` descargan y corren binarios reales y efímeros — usados tanto para los tests de integración como para arrancar los 2 backends de verdad en esta validación.
- **No se modificó código de producción durante esta fase**, salvo una excepción documentada abajo (§1.1).
- Metodología: verificación personal directa de build/arranque/tests + un agente adversarial independiente para el spot-check de 7 áreas transversales (endpoints huérfanos, código muerto, Docker/CI, manejo de errores, accesibilidad, fuga de mocks a producción, migraciones) — sin repetir lo ya cerrado en rondas anteriores.

### 1.1 Única excepción a "no modificar código": archivos de prueba temporales, no producción

Durante esta validación se crearon dos scripts (`startup_smoke.mjs` en `backend (updated)/` y `help_backend/`) para arrancar los servidores reales contra infraestructura efímera y golpearlos con HTTP/WebSocket real. **Se eliminaron ambos al terminar** — no forman parte del repositorio entregado (confirmado: `git status` limpio, `find` no los encuentra). No calificaban como "código de producción modificado"; se mencionan por transparencia porque el agente adversarial los detectó de paso antes de que se borraran.

---

## 2. Hallazgo nuevo más importante: condición de carrera real en el WebSocket de chat (P1)

**Confirmado por reproducción real, no por lectura de código.** `help_backend/websocket/chatSocket.js:213-242`:

```js
async function handleCustomerConnection(ws, req, rawOrgCode) {
  const orgCode = await resolvePublicOrganizationCode(rawOrgCode);   // línea 214 — consulta real a Mongo
  if (!orgCode) { ws.close(1008, '...'); return; }
  const sessionId = uuidv4();
  ws.sessionId = sessionId;
  customerSessions.set(sessionId, { ... });
  ws.on("message", async (message) => { ... });                     // línea 242 — recién acá se registra el listener
```

La validación multi-tenant de la ronda 20 (correcta y necesaria) obligó a hacer async la conexión del cliente, para consultar `Organizations` antes de aceptar el handshake. Pero el listener `ws.on("message", ...)` no se registra hasta que ese `await` resuelve. **Cualquier mensaje que el cliente mande entre el handshake y ese punto se pierde en silencio** — sin error, sin respuesta, sin log del lado del cliente.

**Reproducido en vivo**: un cliente WebSocket real (`ws`, no un mock) que manda su primer mensaje inmediatamente en el evento `open` nunca recibe respuesta (ni `bot_typing`, ni `response`, ni `error` — cero mensajes). El mismo cliente, mandando el mismo mensaje 300ms después, recibe la respuesta del bot correctamente. Diferencia de comportamiento confirmada en dos corridas consecutivas contra el mismo servidor real.

**Severidad — por qué P1 y no P0**: no hay pérdida de datos ni bypass de seguridad; el cliente simplemente no recibe respuesta a su primer mensaje y puede reintentar (UX degradada, no corrupción). En un despliegue real, la latencia de red cliente→servidor normalmente supera a una consulta indexada local a Mongo, así que la ventana de carrera rara vez se dispara — pero con Mongo remoto (Atlas, otra región) o bajo carga, la ventana crece y deja de ser un caso de laboratorio. Es un bug real, reproducido, no teórico.

**No corregido en esta fase** (instrucción explícita del usuario: solo P0 pequeño e inequívoco amerita tocar código durante la validación; esto es P1, y la corrección correcta no es trivial — requiere registrar el listener de mensajes de forma síncrona y encolar/descartar mensajes hasta que la validación de organización resuelva, no un cambio de una línea). Solución sugerida para una futura ronda: registrar `ws.on("message", ...)` sincrónicamente antes del `await`, buffereando el primer mensaje si llega antes de que `orgCode` esté resuelto.

---

## 3. Clasificación por área (checklist de 18 puntos)

### 1. Build y startup — **VERIFICADO** (antes: PARCIAL/NO VERIFICABLE en las 19 rondas previas)
Primera vez en la historia del proyecto que esto se ejecuta de verdad:
- `frontend`, `helpdesk_frontend`, `contract`: `npm run build` (Next.js 16.3.0, webpack) → **`✓ Compiled successfully`** en los 3, generando todas las rutas estáticas/dinámicas esperadas (17, 20 y 3 rutas respectivamente). `npm run lint` (ESLint 9, incluye reglas de JSX/hooks/a11y) → **0 errores** en los 3 (solo warnings preexistentes de estilo, ninguno en archivos tocados por rondas 17-20 salvo advertencias ya presentes antes).
- `backend (updated)`, `help_backend`: arrancados de verdad (`node api.js`) contra MongoDB+Redis reales — ambos llegan a `server_started`, conectan a Mongo, y responden `/health` con `200 {"status":"healthy"}`.
**Nota de entorno, no del proyecto**: el build de `frontend` falló las primeras veces por un bug conocido de npm con dependencias opcionales nativas (`lightningcss`/`@tailwindcss/oxide` — ver https://github.com/npm/cli/issues/4828, el propio error de npm lo referencia); se resolvió reinstalando esos paquetes específicos, sin tocar ningún archivo del repositorio. `helpdesk_frontend` y `contract` no tuvieron este problema.

### 2. Frontend ↔ backend — **VERIFICADO**
Los 3 builds de Next.js compilan con las llamadas reales a `help_backend`/`backend (updated)` intactas. El widget de chat (`helpdesk_frontend/src/app/page.js`) y las páginas públicas de FAQs/artículos ahora mandan `organization_code`/`?org=` — verificado que el backend real los recibe y valida correctamente (arranque real, sección 4). **Regresión de despliegue encontrada** (ver tabla consolidada, hallazgo #2): `docker-compose.yml` no pasa `NEXT_PUBLIC_ORGANIZATION_CODE` como build arg a `helpdesk_frontend`, así que un `docker compose build` real hoy generaría un frontend con esa variable vacía.

### 3. Endpoints — **VERIFICADO, con 1 hallazgo P2 nuevo**
Arranque real confirmó que `/health`, `/api/chat/health`, `/api/chat/session/start`, `/api/faqs/`, `/api/tickets/` responden con los códigos esperados (200/400/401/404 según corresponda). **Hallazgo P2 nuevo**: inconsistencia de nombre de campo entre `POST /session/start` (`organization_code`, snake_case, en el body de entrada) y todas las rutas subsiguientes protegidas por `requireChatSessionToken` (`organizationCode`, camelCase — `help_backend/routes/chatRoutes.js:45`). La propia respuesta de `/session/start` ya usa `organizationCode` (camelCase), así que un cliente que solo mire la respuesta no lo nota — pero un cliente que mande el campo de entrada con el mismo nombre que usa el resto de la API de este mismo servicio (snake_case, como `article_code`/`credential_code`) fallaría en cada llamada posterior. **Impacto real hoy: cero** — confirmado (por mí y por el agente adversarial, independientemente) que ningún consumidor real de `helpdesk_frontend` usa este camino REST; el widget real usa exclusivamente el WebSocket.

### 4. Autenticación — **VERIFICADO**
Arranque real: pedir `/api/tickets/` sin token → `401`; pedir `/api/credentials/by-organization/:code` sin token → `401 {"message":"Access token required"}`; login con credenciales inexistentes → `400`, sin crash ni fuga de información. `algorithms: ['HS256']` explícito confirmado (no re-verificado línea por línea de nuevo, sin cambios desde la ronda 19 en ese punto).

### 5. Autorización / RBAC — **VERIFICADO** (sin cambios desde el cierre del P2 en la ronda 19b)
No tocado por la ronda 20. Verificación rápida: `credentials/design-editor/layout.js` (patrón `chromeless`) sigue presente e intacto.

### 6. Aislamiento multi-tenant — **VERIFICADO, con 2 hallazgos nuevos (1 P1, 1 P2)**
Esta es el área central de la ronda 20. Verificado con ejecución real (MongoDB real, HTTP real, WebSocket real):
- `POST /session/start` sin `organization_code` → `400`. Con uno inexistente → `400`. Con uno real → `200`, token HMAC atado a `sessionId+organizationCode`.
- Reintentar el mismo token con un `organizationCode` distinto (pero también real) → `401` — el HMAC no verifica.
- `GET /faqs/` y `GET /articles/` sin `organization_code` → `400`; con uno real, devuelven solo los documentos de esa organización (confirmado con dos organizaciones reales y datos cruzados en Mongo).
- WebSocket sin `?org=` → cerrado con código `1008`. Con `?org=` real → conexión aceptada, **pero con la condición de carrera del hallazgo P1 de la sección 2**.
- **Hallazgo P2 adicional confirmado por el agente**: `help_backend/models/User.js` tiene `username` con índice `unique: true` **global**, no compuesto con `organization_code` — dos organizaciones no pueden tener un usuario con el mismo username. No es una regresión de la ronda 20 (preexistente), pero la ronda 20 construye multi-tenancy real sobre un modelo de usuarios que en este punto específico sigue sin serlo del todo. No hay migración escrita para convertirlo en índice compuesto.

### 7. DB y migraciones — **VERIFICADO**
`migrate.js` no se tocó en la ronda 20 (correcto — es un backfill de una sola vez, no una ruta de request) y se re-confirmó coherente. Ver el hallazgo del índice de `username` arriba (sección 6) como el único gap real relacionado con DB.

### 8. Integraciones — **VERIFICADO** (salto grande respecto a rondas anteriores)
MongoDB real (vía `mongodb-memory-server`) y Redis real (vía `redis-memory-server`) integrados de verdad en tests y en el arranque de ambos backends — ya no es "NO VERIFICABLE por falta de infraestructura", como sí lo fue en las 19 rondas anteriores. Resend/SMTP siguen sin verificarse (no hay forma de probarlos sin credenciales reales de terceros; fuera del alcance de lo que un entorno de auditoría puede hacer de forma segura).

### 9. Workers / colas / jobs — **VERIFICADO con ejecución real**
`bulkIssuanceQueue.js` probado contra Redis real vía BullMQ real (no mock): `enqueueBulkIssuance` + `getBatchStatus` devuelven totales correctos; un `batchId` de otra organización devuelve `null` (P2 de la ronda 19b, re-confirmado cerrado con ejecución real esta vez, no solo lectura de código).

### 10. IA / RAG — **VERIFICADO lo tocado**
`aiGateway.js` confirmado con ejecución real: sin ninguna API key configurada, salta directo al fallback sin intentar llamadas de red (ni siquiera un timeout) — comportamiento correcto confirmado en el arranque real y en el test WebSocket (log real: `[aiGateway] all providers exhausted (attempted: none configured)`). Los 3 `setInterval` sin `.unref()` (bug encontrado y corregido en la propia ronda 20) confirmados corregidos: la suite de tests ahora sale sola sin necesitar `--test-force-exit`.

### 11. Pagos — **NO APLICA** (sin cambios)

### 12. Notificaciones — **NO APLICA a la ronda 20** (sin cambios; ver hallazgos ya documentados en `AUDIT_FIXES.md`/versión anterior de este archivo)

### 13. Seguridad — **VERIFICADO, con 1 P1 y 2 P2 nuevos (ver secciones 2 y 6)**
Sin secretos nuevos, sin `eval`/`exec`/`new Function` nuevos, sin inyección NoSQL nueva — el regex `^[A-Za-z0-9_-]{2,50}$` de `resolvePublicOrganizationCode` se probó con ejecución real contra un intento de inyección (`organization_code=$ne`) → `400`, rechazado antes de tocar Mongo (test real, no teórico). El P1 de la sección 2 es un bug de disponibilidad/UX (mensaje perdido), no de confidencialidad/integridad — no expone datos de otra organización.

### 14. Flujos críticos E2E — **PARCIAL** (mejora real, no total)
Verificado con ejecución real de punta a punta: `session/start` → mensaje → respuesta del bot (HTTP, vía `supertest`, y WebSocket, vía cliente real). **No verificado E2E con navegador real** (sin Chrome/Playwright en este entorno) — el clic real en la UI de `helpdesk_frontend` sigue sin probarse, aunque el build de producción de esa UI sí compila limpio por primera vez.

### 15. Responsive / accesibilidad funcional — **VERIFICADO lo tocado en ronda 20**
Confirmado por el agente adversarial: el toggle de `guest_recipient` mantiene `role="switch"`/`aria-checked`; los modales usan el componente `Dialog` de shadcn/ui (maneja foco/Escape internamente). Sin regresiones nuevas de accesibilidad introducidas por la ronda 20.

### 16. Docker / CI/CD — **FALLA (1 hallazgo P2 real)**
`docker-compose.yml` no fue actualizado en la ronda 20 pese a que el frontend público (`helpdesk_frontend`) ahora requiere `NEXT_PUBLIC_ORGANIZATION_CODE` en tiempo de build para que el chat/FAQs/artículos funcionen. Confirmado independientemente por mí y por el agente adversarial (misma línea, mismo hallazgo). `.github/workflows/ci.yml` no necesita cambios (no construye vía compose).

### 17. Manejo de errores — **VERIFICADO**
Los `catch` vacíos en `publicOrganization.js` y `articleController.js` son deliberados y documentados (fallback intencional de sesión inválida a ruta pública), confirmado por el agente. Sin `catch` silenciosos nuevos que oculten errores reales.

### 18. Regresiones — **CONFIRMADAS: 1 P1 nueva (condición de carrera WS), 2 P2 nuevas** (tabla consolidada abajo). Cero P0.

---

## 4. Tabla consolidada de hallazgos de la ronda 20

| # | Hallazgo | Ubicación | Severidad | Confirmado por |
|---|---|---|---|---|
| 1 | Condición de carrera: primer mensaje WebSocket se pierde en silencio | `help_backend/websocket/chatSocket.js:213-242` | **P1** | Reproducción real (cliente WS real, con y sin delay) |
| 2 | `docker-compose.yml` no pasa `NEXT_PUBLIC_ORGANIZATION_CODE` al build de `helpdesk_frontend` | `docker-compose.yml:168-173` | **P2** | Verificación personal + agente adversarial, independientemente |
| 3 | Inconsistencia de naming `organization_code` (entrada de `/session/start`) vs. `organizationCode` (todo lo demás) | `help_backend/routes/chatRoutes.js:45,70` | P2 (impacto real: 0, sin consumidores) | Lectura de código + confirmado sin consumidores reales |
| 4 | `User.username` con índice único global, no compuesto con `organization_code` | `help_backend/models/User.js:13` | P2 (preexistente, no de esta ronda) | Descubierto escribiendo tests (E11000 real), confirmado por agente |
| 5 | Endpoints REST de chat sin consumidor real (`/session/start`, `/message`, `/rate`, `/agents/available`, `/contact-request`) | `help_backend/routes/chatRoutes.js` | P3 (preexistente desde ronda 16, documentado, no nuevo) | Agente adversarial (grep exhaustivo) |
| 6 | `openapi.yaml` no documenta el esquema multi-tenant nuevo (`organization_code`, `?org=`) | `openapi.yaml` | P3 (mismo gap preexistente, ahora más grande) | Lectura de código |

Todos los hallazgos P2/P3 de la ronda 19 (cerrados en la 19b) se re-confirmaron intactos: scoping cross-tenant de `bulk-issue` (ahora con ejecución real contra Redis, no solo lectura), validación de colisión de `achiever_username`, layout `chromeless` de `design-editor`, scheduler de `geminiService.js`.

---

## 5. Evidencia de ejecución real (nueva en esta ronda — antes NO VERIFICABLE por entorno)

| # | Verificación | Resultado |
|---|---|---|
| 1 | `npm run build` — `frontend` (Next.js 16.3.0, webpack) | ✅ `Compiled successfully`, 17 rutas generadas |
| 2 | `npm run build` — `helpdesk_frontend` | ✅ `Compiled successfully`, 20 rutas generadas |
| 3 | `npm run build` — `contract` | ✅ `Compiled successfully`, 3 rutas generadas |
| 4 | `npm run lint` (ESLint 9, JSX+hooks+a11y) — `frontend` | ✅ 0 errores, 31 warnings preexistentes |
| 5 | `npm run lint` — `helpdesk_frontend` | ✅ 0 errores, 14 warnings preexistentes |
| 6 | Arranque real `backend (updated)` contra MongoDB+Redis reales | ✅ `server_started`, `/health` → 200 healthy |
| 7 | Arranque real `help_backend` contra MongoDB real | ✅ `server_started`, `/api/chat/health` → 200 |
| 8 | Cliente WebSocket real, sin `?org=` | ✅ cerrado con código 1008 (correcto) |
| 9 | Cliente WebSocket real, con `?org=` válido, mensaje inmediato | ❌ sin respuesta (hallazgo P1, sección 2) |
| 10 | Cliente WebSocket real, con `?org=` válido, mensaje con 300ms de margen | ✅ respuesta del bot recibida correctamente |
| 11 | Inyección NoSQL (`organization_code=$ne`) contra endpoint real | ✅ rechazado con 400 antes de tocar Mongo |
| 12 | Suite completa de tests, corrida fresca, una sola vez | ✅ **78 passed, 0 failed** (ver tabla siguiente) |

**Resultado de tests, corrida final y única de esta validación:**
```
backend (updated):    39 passed, 0 failed
help_backend:         15 passed, 0 failed
frontend:              18 passed, 0 failed
helpdesk_frontend:      3 passed, 0 failed
contract:               3 passed, 0 failed
--------------------------------------------------------
TOTAL:                 78 passed, 0 failed
```
Sin mocks de infraestructura: los tests de integración usan MongoDB y Redis reales y efímeros.

---

## 6. Tabla consolidada final

| Área | Estado | Evidencia | Riesgo residual |
|---|---|---|---|
| 1. Build y startup | **VERIFICADO** | Build real de los 3 Next.js + arranque real de los 2 backends contra Mongo/Redis reales | Ninguno nuevo; bug de npm (dep. opcional nativa) es del entorno, no del proyecto |
| 2. Frontend ↔ backend | VERIFICADO | Builds compilan con las llamadas reales intactas | `docker-compose.yml` no pasa la var nueva (hallazgo #2) |
| 3. Endpoints | VERIFICADO (1 P2) | Arranque real + inconsistencia de naming confirmada | Sin consumidores reales hoy, cero impacto actual |
| 4. Autenticación | VERIFICADO | 401/400 correctos en arranque real | Ninguno nuevo |
| 5. Autorización/RBAC | VERIFICADO | Sin cambios desde el cierre de la ronda 19b | Ninguno nuevo |
| 6. Multi-tenant | VERIFICADO (1 P1, 1 P2) | Ejecución real: HTTP + WS + Mongo real | Condición de carrera WS (sección 2); índice de username global |
| 7. DB y migraciones | VERIFICADO | `migrate.js` coherente, sin cambios necesarios | Índice de `username` no compuesto (preexistente) |
| 8. Integraciones | **VERIFICADO** | MongoDB y Redis reales integrados en tests y arranque | Resend/SMTP sin verificar (fuera de alcance seguro) |
| 9. Workers/colas/jobs | **VERIFICADO con ejecución real** | BullMQ + Redis real, scoping cross-tenant confirmado con ejecución | Ninguno nuevo |
| 10. IA/RAG | VERIFICADO | Fallback sin red confirmado en ejecución real; unref() corregido | Ninguno nuevo |
| 11. Pagos | NO APLICA | — | — |
| 12. Notificaciones | Sin cambios en esta ronda | — | Ver versión anterior de este archivo |
| 13. Seguridad | VERIFICADO (1 P1, 2 P2) | Inyección NoSQL rechazada con ejecución real | Ver secciones 2 y 6 |
| 14. Flujos E2E | PARCIAL | HTTP+WS real E2E sí; navegador real no | Sin Chrome/Playwright en este entorno |
| 15. Responsive/accesibilidad | VERIFICADO | Sin regresiones en lo tocado por ronda 20 | Ninguno nuevo |
| 16. Docker/CI/CD | **FALLA (1 P2)** | `docker-compose.yml` sin `NEXT_PUBLIC_ORGANIZATION_CODE` | Deploy vía compose rompe chat/FAQs hasta corregirlo |
| 17. Manejo de errores | VERIFICADO | Catches vacíos son deliberados y documentados | Ninguno nuevo |
| 18. Regresiones | CONFIRMADAS (1 P1, 2 P2 nuevas) | Ver tabla sección 4 | Ninguna P0 |

---

## 7. Respuestas explícitas

**¿Compila?** **Sí, verificado con ejecución real** — los 3 Next.js compilan limpio (`Compiled successfully`) y ambos backends Express arrancan y sirven tráfico real contra MongoDB/Redis reales. Primera vez en 20 rondas que esta pregunta tiene una respuesta verificada por ejecución, no por lectura de código.

**¿Arranca? ¿Todos los botones funcionan?** Los servidores arrancan, verificado con ejecución real. "Todos los botones" en el sentido de clic-en-navegador-real **no** se verificó (sin Chrome/Playwright disponible) — los flujos se verificaron por HTTP/WebSocket real, que es el 100% de lo que un botón termina disparando, pero no el pixel-por-pixel de la UI.

**¿Frontend y backend están conectados?** Sí. Con una salvedad real: el despliegue vía `docker-compose.yml` necesita un ajuste (hallazgo #2) para que esa conexión funcione en un `docker compose up` real hoy mismo.

**¿DB y migraciones funcionan?** Sí, verificado con MongoDB real (no un mock). `migrate.js` coherente. Un gap preexistente (índice de `username` no compuesto) queda documentado, no es nuevo de esta ronda.

**¿Los roles y permisos funcionan?** Sí, sin cambios desde el cierre del P2 de la ronda 19b (no tocado por la ronda 20, re-confirmado presente).

**¿Existe aislamiento multi-tenant?** **Sí, y por primera vez verificado con ejecución real** (HTTP + WebSocket + Mongo real, no solo lectura de código) — con una condición de carrera real (P1, sección 2) que puede causar que el primer mensaje de un chat se pierda en silencio bajo ciertas condiciones de timing, no un cruce de datos entre organizaciones.

**¿Los flujos críticos funcionan E2E?** Verificado E2E a nivel de protocolo (HTTP y WebSocket reales, de punta a punta: sesión → mensaje → respuesta). No verificado con un navegador real haciendo clics.

**¿Las integraciones reales están verificadas?** MongoDB y Redis: **sí, por primera vez, con ejecución real.** Resend/SMTP: no (requieren credenciales de terceros que este entorno no puede usar de forma segura).

**¿Los tests pasan?** **Sí — 78 passed, 0 failed**, corrida fresca y única, contra infraestructura real (no mocks). Ver tabla sección 5.

**¿Queda algún P0?** **No.** Ni la verificación personal ni el agente adversarial encontraron ningún P0 (pérdida de datos, bypass de autenticación, corrupción, caída total) en la ronda 20.

**¿Queda algún P1?** **Sí, uno nuevo y real**: la condición de carrera del WebSocket (sección 2) — confirmada por reproducción, no teórica. Es de disponibilidad/UX (mensaje perdido, recuperable reintentando), no de seguridad o integridad de datos.

**¿Hay regresiones?** Sí — 1 P1 nueva (condición de carrera WS) y 2 P2 nuevas (naming inconsistente sin consumidores reales; `docker-compose.yml` desactualizado), ninguna P0. Cero regresiones en lo que ya estaba cerrado de rondas anteriores (bulk-issue scoping, guest_recipient, RBAC de `teacher`, scheduler de `geminiService.js` — los 4 P2 de la ronda 19b se re-confirmaron intactos, ahora con ejecución real donde antes solo había lectura de código).

**¿Está preparado para producción?** **No sin condiciones**, pero el motivo cambió respecto a las 19 rondas anteriores: ya no es "nunca se verificó contra infraestructura real" (eso se resolvió en gran parte esta ronda). Ahora son 3 cosas concretas y acotadas: (1) corregir la condición de carrera del WebSocket, (2) actualizar `docker-compose.yml` con la variable nueva, (3) decidir si vale la pena resolver la inconsistencia de naming antes de que el camino REST del chat tenga un consumidor real.

---

## 8. Porcentaje real del proyecto y qué falta

**89/100** (ronda anterior: 84/100).

Sube 5 puntos, no más, porque:
1. **El salto real es enorme pero no gratuito**: por primera vez se verificó con ejecución real build, arranque, DB, colas, y un cliente WebSocket real — y esa misma verificación real encontró un bug (la condición de carrera) que ninguna lectura de código, por cuidadosa que fuera, iba a encontrar. Eso es exactamente lo que se esperaba que pasara al finalmente poder ejecutar el sistema: subir la confianza real, no solo la teórica.
2. **`docker-compose.yml` quedó desactualizado** respecto a un cambio de arquitectura real (multi-tenancy) — un despliegue real hoy, vía el método documentado (`docker compose up`), no funcionaría correctamente para el chat/FAQs/artículos sin ese ajuste manual.
3. Persisten gaps ya conocidos y no cerrados por decisión explícita (no P0): endpoints REST de chat sin consumidor real, `openapi.yaml` desactualizado, índice de `username` no compuesto.

No baja de ahí porque:
- Cero P0 encontrados, en ninguna de las dos rondas de validación adversarial de este proyecto.
- Los 78 tests (incluyendo 32 nuevos contra infraestructura real) pasan limpio, corrida fresca y única.
- Los 4 P2 de la ronda 19b se sostuvieron bajo ejecución real, no solo bajo relectura de código.
- El único P1 nuevo es de disponibilidad/UX, recuperable con un reintento del usuario, no de seguridad ni de integridad de datos.

**Qué falta, en orden de prioridad:**
1. Corregir la condición de carrera del WebSocket (sección 2) — registrar el listener de mensajes antes del `await` de validación de organización.
2. Agregar `NEXT_PUBLIC_ORGANIZATION_CODE` a los build args de `helpdesk_frontend` en `docker-compose.yml`.
3. Unificar el naming `organization_code`/`organizationCode` en las rutas de chat, o documentar explícitamente la diferencia si se decide mantenerla.
4. Migración para volver compuesto el índice de `username` (`{username, organization_code}`) si de verdad se quiere soportar el mismo username en dos organizaciones distintas — o documentar explícitamente que no se soporta.
5. Actualizar `openapi.yaml` con el esquema multi-tenant nuevo.
6. Verificar el flujo con un navegador real (Playwright/Chrome) cuando haya un entorno que lo permita — es el único eslabón que sigue sin ejecución real en todo el proyecto.
