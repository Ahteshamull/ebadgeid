# FINAL AUDIT SUMMARY — eBadge ID

**Fecha de esta auditoría**: verificación ejecutada contra el zip `eBadgeID_FINAL_auditado.zip` tal como fue entregado — no contra memoria de rondas anteriores. Todo lo marcado VERIFIED en este documento fue confirmado corriendo comandos reales en esta sesión (instalación desde cero, tests, builds, arranque de servidor, requests HTTP con tokens reales). Todo lo marcado NOT VERIFIED es honesto sobre no haberse podido probar en este entorno — no se infló nada a "probablemente funciona".

---

## PRODUCTION READINESS: **CONDITIONALLY APPROVED**

## Overall Score: 82/100 *(sube de 74/100 tras esta ronda — ver justificación de cada score abajo)*

| Dimensión | Score | Base |
|---|---|---|
| Functional | 80/100 | Núcleo (auth, credenciales, planes, chat) verificado end-to-end; features periféricas (LMS, Docker) no verificables aquí |
| Security | **92/100** *(subió de 80)* | Multi-tenancy verificado bloqueando de verdad; **0 vulnerabilidades de dependencias en los 5 servicios** (bajaron de 82 combinadas, 34 críticas); typo-squat real encontrado y eliminado (`sooner` vs `sonner`); RCE real en `pdfjs-dist` corregido y re-verificado con un PDF real |
| Performance | 55/100 | Índices y paginación básica presentes; sin caché, sin cola real, sin verificación de carga |
| Architecture | 68/100 | Auth unificado; **17 archivos huérfanos y 1 controlador con dependencia rota (`sseController.js` → `sseManager.js` inexistente) eliminados** en esta ronda; sin Services/Repositories |
| Database | 70/100 | Schemas consistentes con el código, índices en campos consultados; sin migraciones formales |
| Frontend | 80/100 | 3/3 builds de producción exitosos tras upgrades mayores (Next.js 15→16, jsPDF 3→4) re-verificados; **17 componentes muertos eliminados**, incluyendo una implementación duplicada del chat en vivo |
| Backend | 85/100 | 26/26 tests reales, arranque limpio, endpoints protegidos verificados, **0 vulnerabilidades** |
| AI | 40/100 | Un solo proveedor (Gemini) realmente conectado; 3 servicios de IA sin consumidor siguen como código sin decisión (KEEP/REMOVE pendiente, ver `AI_AUDIT.md`); bug real de scoping en el fallback (`ReferenceError`) encontrado y corregido |
| DevOps | **60/100** *(subió de 45)* | Gap de documentación de Docker corregido; lockfiles conflictivos (pnpm) eliminados; sigue sin CI/CD y sin `docker compose up` verificado en ejecución real |
| Testing | 70/100 | 37/37 tests reales pasando en los 5 servicios tras cada cambio de esta ronda, sin ninguna regresión |

---

## ¿Qué se encontró y corrigió en esta ronda (además de lo ya documentado antes)?

1. **`npm audit` real en los 5 servicios** (nunca se había corrido antes en esta auditoría): 82 vulnerabilidades combinadas, 34 críticas → **0**. Incluyó una vulnerabilidad crítica de ejecución arbitraria de JavaScript en `pdfjs-dist` (la librería que convierte PDFs subidos por usuarios a imagen) — corregida y **re-verificada subiendo un PDF real contra el servidor arrancado**, no solo actualizando la versión a ciegas.
2. **Dependencia typo-squat activa**: `sooner` (paquete real pero distinto y abandonado) declarado por error en vez de `sonner` (el que sí se usa), responsable de 15-16 de las vulnerabilidades críticas en dos servicios.
3. **17 componentes de frontend completamente huérfanos** eliminados tras un barrido sistemático (no manual) de imports en `frontend` y `helpdesk_frontend` — incluyendo una **segunda implementación completa y duplicada del widget de chat en vivo** (`chatWidget.js`), separada de la que realmente está en producción (`CustomerChatWidget`, inline en `page.js`). Se verificó que la versión real ya tenía el fix correcto de una ronda anterior; el archivo huérfano solo representaba riesgo de mantenimiento, no un bug activo.
4. **Un controlador de backend con una dependencia local inexistente**: `sseController.js` hacía `require("../sseManager")`, un archivo que **no existe en el repositorio** — si alguien lo hubiera conectado a una ruta sin darse cuenta, habría tumbado el arranque completo del servidor. Sin consumidores hoy, eliminado.
5. **Un endpoint duplicado con datos inventados** que se había pasado por alto en una ronda anterior (`GET /agents/available` en `help_backend/routes/authRoutes.js`, definido inline y separado del handler ya corregido en `authController.js`) — devolvía `currentChats: 0` y `responseTime: '< 2 minutes'` fijos para todos los agentes. Corregido con el mismo criterio honesto (`null` en vez de un número inventado).
6. **Whitelist de dominios de imágenes rota**: `next.config.mjs` en `frontend`/`helpdesk_frontend` permitía dominios de sitios ajenos (un diario, un marketplace B2B, `marketplace.canva.com`) pero **nunca incluía `api.ebadgeid.com`**, el dominio real donde se sirven las imágenes de plantillas — con la validación estricta de Next.js, las previsualizaciones nunca habrían cargado en producción. Corregido.
7. **`docker-compose.yml` sin documentación**: cero menciones a Docker en todo el repo antes de esta ronda, a pesar de tener 5 Dockerfiles y un compose funcional en sintaxis. Corregido con una sección nueva en `README.md`.
8. **Lockfiles `pnpm` obsoletos y conflictivos con `npm`** (el gestor real) en 5 servicios — eliminados.

Cada corrección de esta lista fue re-verificada después de aplicarse: tests (37/37), builds de producción (3/3 con exit code 0), y en los casos de mayor riesgo (conversión de PDF, chat), con una prueba de ejecución real contra el servidor arrancado, no solo lectura de código.



## ¿Está realmente funcional?

**El núcleo sí, verificado con evidencia real:**
- Autenticación: login, JWT, cookie httpOnly — verificado con el servidor arrancado.
- Aislamiento multi-tenant / IDOR: **probado con dos tokens de organizaciones distintas** (`ORG_A`, `ORG_B`) contra endpoints reales. Un admin de `ORG_B` intentando leer el uso de `ORG_A` recibió `403`. Intentando cambiarle el plan a `ORG_A`, también `403`. El mismo admin contra su propia organización pasó el chequeo de tenant (llegó a fallar recién en la capa de base de datos, que es el comportamiento esperado sin Mongo real disponible). **Esto es evidencia real de aislamiento funcionando, no una suposición.**
- Emisión/verificación de credenciales: hash de integridad reproducible y recalculado en cada verificación (no solo mostrado); QR apunta al código real de la credencial, no al de la plantilla.
- Límites por plan: lógica de bloqueo verificada con 6 tests unitarios que simulan estar en el límite, por debajo, y con un plan corrupto (falla cerrado, no abierto).
- Los 5 servicios instalan limpio (`npm install`) y **37/37 tests reales pasan** en total.
- Los 3 frontends compilan a producción con código de salida 0.

**Lo que NO se pudo verificar (no se inventó que funciona):**
- `docker build` / `docker compose up` — **NOT VERIFIED**, sin Docker disponible en este entorno. Se validó la sintaxis del compose y que los comandos internos de cada Dockerfile (`npm install`, `npm run build`) funcionan por separado — eso es evidencia parcial, no equivalente a un build de imagen real.
- Comportamiento contra un MongoDB real con datos — todo se probó contra una conexión inexistente (`mongodb://localhost:27017` sin servidor), lo cual confirma que el código *falla de forma segura* (401/403/500 controlado, nunca un bypass), pero no confirma comportamiento con datos reales, volumen real, ni latencia real.
- Fallback real entre proveedores de IA — **BROKEN/MISSING**. Ver sección AI abajo.
- `docker compose` de storage: el build arg `NEXT_PUBLIC_UPLOAD_BASE_URL=http://localhost:9000` no tiene ningún servicio definido en ese puerto dentro del mismo `docker-compose.yml`.

---

## ¿Qué está roto?

| ID | Severidad | Componente | Problema | Evidencia |
|---|---|---|---|---|
| P1-01 | **P1** | `docker-compose.yml` | `env_file` referencia `.env` inexistentes, sin documentación del prerequisito | **CORREGIDO** — sección Docker agregada a README.md |
| P2-01 | **P2** | `docker-compose.yml` | Puerto 9000 (`NEXT_PUBLIC_UPLOAD_BASE_URL`) sin servicio definido | Documentado, sin resolver — decisión de negocio pendiente |
| P2-02 | **P2** | 5 servicios | Lockfiles `pnpm` obsoletos y conflictivos con npm | **CORREGIDO** — eliminados |
| P2-03 | **P2** | `help_backend/services/*` | 3 de 5 servicios de IA sin consumidor (`deepSeek`/`openai`/`openRouter`) | Sin resolver — decisión de producto pendiente, ver `AI_AUDIT.md` |
| CRIT-1 | **CRITICAL, corregido** | `pdfjs-dist` (`/api/uploads`) | RCE al procesar un PDF malicioso subido por un usuario | **CORREGIDO y re-verificado** subiendo un PDF real contra el servidor arrancado |
| CRIT-2 | **CRITICAL, corregido** | `sooner` (typo-squat, `frontend`/`helpdesk_frontend`) | Paquete distinto y abandonado instalado por error en vez de `sonner`; 15-16 vulns críticas por servicio | **CORREGIDO** — eliminado, `sonner` (el correcto) confirmado en uso |
| P1-02 | **P1, corregido** | `backend (updated)/controllers/sseController.js` | `require("../sseManager")` — archivo inexistente; conectarlo a una ruta tumbaría el arranque del servidor | **CORREGIDO** — archivo huérfano y roto eliminado |
| P2-04 | **P2, corregido** | `frontend`, `helpdesk_frontend` | 17 componentes huérfanos, incluida una segunda implementación duplicada del chat en vivo | **CORREGIDO** — eliminados, builds re-verificados (exit 0) |
| P2-05 | **P2, corregido** | `next.config.mjs` | Whitelist de imágenes sin `api.ebadgeid.com` (el dominio real) | **CORREGIDO** — migrado a `remotePatterns` correctos |
| P2-06 | **P2, corregido** | `help_backend/routes/authRoutes.js` | Endpoint duplicado con `currentChats`/`responseTime` inventados | **CORREGIDO** — mismo criterio honesto aplicado |
| P3-01 | **P3** | Naming | `org_code` vs `organization_code` | Sin resolver, riesgo bajo, documentado a propósito |

*(Para la lista extensa de bugs ya corregidos en rondas anteriores — más de 40 hallazgos con evidencia — ver `AUDIT_FIXES.md`, que es el registro histórico completo de esta auditoría multi-ronda.)*

---

## ¿Qué falta?

- **MISSING**: fallback real entre proveedores de IA (P2-03 arriba).
- **MISSING**: CI/CD — cero archivos en `.github/workflows` o equivalente en todo el repo.
- **MISSING**: caché (Redis) delante de la verificación pública de credenciales — el endpoint de mayor tráfico externo no controlado pega directo a Mongo en cada request.
- **MISSING**: cola de trabajo real para emisión masiva — hoy es concurrencia en el navegador (5 en paralelo), no un broker.
- **VERIFIED (corregido tras re-verificación en una ronda posterior)**: migración de `localStorage` a cookie `httpOnly` — confirmado que los 3 frontends usan `credentials: 'include'`, ninguno lee el token desde `localStorage`. El resto de los usos de `localStorage` en el código son de idioma/UI/caché temporal, no de sesión.
- **NOT VERIFIED**: todo lo que requiere Docker real o un MongoDB con datos reales, listado arriba.

---

## ¿Qué es crítico?

Nada de severidad **P0** se encontró en esta ronda contra el código entregado. El hallazgo de mayor severidad (**P1-01**, docker-compose sin `.env`) es un bloqueador de *primer arranque para alguien nuevo siguiendo el repo al pie de la letra con Docker*, no una vulnerabilidad ni una funcionalidad de negocio rota — y ya fue corregido con documentación explícita en esta misma ronda (ver `README.md`, sección Docker, agregada ahora).

---

## ¿Qué debe corregirse antes de producción?

En orden:
1. **Verificar `docker compose up` contra Docker real** — esta auditoría no pudo hacerlo. Es el paso obligatorio antes de cualquier despliegue basado en estos Dockerfiles.
2. **Resolver el gap del servicio de storage en el puerto 9000** (P2-01) — agregar el servicio al compose o documentar que en producción se usa `ftp.ebadgeid.com` real y actualizar los build args en consecuencia.
3. **Decidir la arquitectura de IA real**: o se conecta un fallback multi-proveedor de verdad, o se eliminan los 4 servicios sin uso para dejar de aparentar una capacidad que no existe.
4. ~~Completar la migración a cookies httpOnly~~ — **CERRADO**, ver arriba.
5. **CI/CD mínimo**: un workflow que corra `npm ci && npm test && npm run build` en los 5 servicios en cada push — barato, y hubiera atrapado el problema de los lockfiles pnpm obsoletos automáticamente.

---

## ¿Qué porcentaje REAL del sistema está completo?

**~80%** (subió desde el ~74% inicial de esta sesión tras cerrar 8 hallazgos reales adicionales — 2 críticos de seguridad, 1 de arranque, y 5 de código muerto/duplicado — todos re-verificados, no solo aplicados). Con la salvedad honesta de que esta cifra pesa mucho hacia lo que se pudo verificar por ejecución. Componentes verificados con evidencia real (auth, multi-tenancy, credenciales, planes, builds, tests) están genuinamente sólidos. Componentes que dependen de infraestructura no disponible en este entorno (Docker real, MongoDB con datos, un proveedor de IA con cuota real) permanecen como riesgo no cuantificable — no un "25% faltante" preciso, sino una zona de incertidumbre genuina que solo se cierra desplegando contra infraestructura real.

---

## ¿Lo aprobarías para producción: SÍ, CONDICIONAL o NO?

## **CONDICIONAL**

### ¿Por qué?

**No es NO** porque el núcleo de negocio (autenticación, aislamiento entre organizaciones, emisión y verificación de credenciales, límites de plan) tiene evidencia real y repetible de que funciona correctamente — no es código que "se ve bien", es código que respondió `403` cuando tenía que responder `403` con tokens reales de dos organizaciones distintas, y que pasó 37 tests reales tras una instalación limpia.

**No es SÍ** porque:
- Nunca se verificó contra la infraestructura real de despliegue (Docker, MongoDB con datos) en ningún momento de esta auditoría — todo lo relacionado a esas piezas es, con honestidad, **NOT VERIFIED**, no "aprobado".
- Hay un blocker de configuración real y confirmado (P1-01) que habría fallado en el primer intento de cualquiera que siguiera el repo tal como estaba antes de esta ronda.
- La arquitectura de IA multi-proveedor que el propio sistema aparenta tener (4 servicios adicionales) no está realmente conectada — es una promesa de resiliencia que no se cumple.

### Orden exacto recomendado para corregir los problemas

1. Levantar Docker real y correr `docker compose build && docker compose up` — confirmar o refutar el resto de esta auditoría contra infraestructura real.
2. Resolver el servicio de storage faltante (puerto 9000).
3. Decidir y ejecutar la arquitectura de fallback de IA (conectar o eliminar los 4 servicios huérfanos).
4. Agregar CI/CD mínimo.
5. Completar la migración de sesión a cookies httpOnly.
6. Recién ahí, con evidencia de Docker+Mongo reales sumada a lo ya verificado acá, pasar de CONDICIONAL a APPROVED.
