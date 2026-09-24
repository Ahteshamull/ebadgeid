# eBadge ID — Documentación técnica y despliegue

> Estado vigente: consulte **`AUDIT_FIXES.md`** (la única fuente que se actualiza en cada ronda, historial completo con evidencia real) y `PRODUCTION_RUNBOOK.md` (referencia operativa). Todo lo demás bajo `docs/history/` es un snapshot de una ronda puntual y no representa el estado actual — no confíe en su fecha de nombre de archivo.

Plataforma de credenciales digitales (tipo Credly) con cinco servicios independientes. Este documento cubre cómo levantar cada uno, qué variables de entorno necesita, y el estado real del proyecto — no un README genérico.

Para el detalle de qué se auditó, qué se corrigió y qué queda pendiente (y por qué), ver **`AUDIT_FIXES.md`** en la raíz de este repositorio. Este documento es solo "cómo lo hago andar".

## Arquitectura

| Servicio | Stack | Puerto sugerido | Rol |
|---|---|---|---|
| `backend (updated)` | Node/Express + MongoDB (Mongoose) | 5000 | API principal: usuarios, organizaciones, credenciales, contratos, dashboards |
| `help_backend` | Node/Express + MongoDB + WebSocket | 5000* | Helpdesk: artículos, FAQs, chat en vivo, OTP |
| `frontend` | Next.js | 3000 | Panel de administración (orgs, usuarios, credenciales, reportes) |
| `helpdesk_frontend` | Next.js | 3000* | Centro de ayuda + gestión de artículos |
| `contract` | Next.js | 3000* | Firma y gestión de contratos digitales |

\* Cada servicio corre en un puerto propio en producción real (subdominios distintos: `api.ebadgeid.com`, `hapi.ebadgeid.com`, etc.) — en local, cambiá `PORT` en cada `.env` para no pisarte.

Los tres frontends son proyectos Next.js independientes, no un monorepo con workspaces — cada uno tiene su propio `package.json` y se despliega por separado.

## Requisitos

- Node.js 18+ (probado con Node 22)
- MongoDB 7 accesible. `docker-compose.yml` incluye una instancia autenticada
  de desarrollo/staging con replica set; producción puede usar una instancia
  administrada equivalente.
- Una casilla SMTP real (`EMAIL_USER`/`EMAIL_PASS`, hoy `info@ebadgeid.com`) — todo el correo saliente (credenciales emitidas, invitaciones, notificaciones, contratos) sale de ahí. No hay proveedor de email transaccional de terceros (Resend se eliminó por completo — ver `AUDIT_FIXES.md`); es SMTP directo, un único remitente para todo

## Puesta en marcha — backend principal (`backend (updated)`)

```bash
cd "backend (updated)"
cp .env.example .env
# completar .env con credenciales reales — ver la sección de variables abajo
npm install
npm test      # corre la suite real (10 tests) antes de levantar nada
npm start     # node api.js
```

Variables de entorno (`.env.example` ya trae todos los nombres, esto es qué significa cada una):

| Variable | Para qué |
|---|---|
| `MONGO_URI` | Conexión a MongoDB |
| `JWT_SECRET` | Firma de tokens de sesión — generar con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`, nunca reusar el que traía este proyecto originalmente (estaba expuesto) |
| `EMAIL_USER` / `EMAIL_PASS` | La única casilla SMTP real que envía todo el correo saliente del sistema (credencial emitida, invitaciones, notificaciones, contratos) — hoy `info@ebadgeid.com`. En **desarrollo**, si falta, el servidor igual arranca y el envío de emails falla silenciosamente y queda logueado. En **producción** (`NODE_ENV=production`) es obligatoria: `api.js` valida un arreglo de variables requeridas al arrancar y el proceso no levanta si falta — comportamiento fail-closed intencional, no un bug |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_SECURE` | Opcional — solo si la casilla no es Gmail (ver `utils/smtpTransporter.js`) |
| `ALLOWED_ORIGINS` | Lista separada por comas de orígenes permitidos por CORS — sin esto, CORS bloquea todo salvo llamadas sin header `Origin` |

El login crea una cookie de sesión `httpOnly` (`ebadge_token`). En producción
se marca `Secure`, y las escrituras autenticadas usan protección CSRF. El
cliente no persiste el token de sesión en `localStorage`.

## Base de datos: MongoDB, no Postgres

Este proyecto usa MongoDB (Mongoose) en los cinco servicios y así se mantiene — ver `AUDIT_FIXES.md`, sección "Sobre agregar PostgreSQL", para el razonamiento completo.

## Puesta en marcha — `help_backend`

```bash
cd help_backend
cp .env.example .env
npm install
npm start
```

Mismo patrón de variables (Mongo, JWT, email) más las claves de IA/integraciones (`OPENAI_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`) que usa el chatbot del helpdesk, y `SHOPIFY_STORE`/`SHOPIFY_TOKEN` si esa integración está en uso.

## Puesta en marcha — los tres frontends

```bash
cd frontend            # o helpdesk_frontend, o contract
npm install
npm run dev             # desarrollo
npm run build && npm start   # producción
```

Los frontends **no tienen variables de entorno para la URL del API** — apuntan a dominios fijos (`https://api.ebadgeid.com`, etc.) declarados en el código (`frontend/src/lib/api.js` centraliza esto para `frontend`; `helpdesk_frontend` y `contract` todavía tienen la URL repetida en varios archivos — ver AUDIT_FIXES.md, punto de deuda técnica). Para apuntar a un backend distinto (staging, local), hay que editar esas constantes.

## Orden de arranque recomendado

1. MongoDB accesible (Atlas o local).
2. `backend (updated)` — la mayoría de las funciones del sistema dependen de este.
3. `help_backend` — independiente, pero `frontend` puede tener enlaces al helpdesk.
4. Los tres frontends, en cualquier orden.

## Verificación de que todo levantó bien

```bash
curl http://localhost:5000/api/users        # -> 401 (correcto: requiere token)
curl http://localhost:5000/api/credentials/by-code/ALGUN_CODIGO   # -> 404 si no existe, 200 si existe (público a propósito)
curl http://localhost:5060/health           # help_backend -> {"status":"healthy",...}
```

Si `/api/users` devuelve algo distinto de 401 sin mandar token, algo se rompió — todas las rutas administrativas deben exigir sesión (ver AUDIT_FIXES.md, hallazgo 1.1, para el porqué esto es lo primero a verificar).

## Docker / docker-compose

Existe un `docker-compose.yml` en la raíz con 7 servicios (`mongo`, `redis`, `api`, `help-api`, `app`, `helpdesk`, `contracts`). **No se pudo verificar `docker build`/`docker compose up` en el entorno donde se hizo esta auditoría (sin Docker disponible)** — lo que sí se verificó es que cada comando que los Dockerfiles ejecutan (`npm install`, `npm run build`) funciona por separado. Antes de correrlo:

```bash
# Cada servicio backend necesita su .env real — docker-compose los referencia
# vía env_file y falla si no existen.
cp "backend (updated)/.env.example" "backend (updated)/.env"
cp help_backend/.env.example help_backend/.env
# completar ambos con credenciales reales antes de levantar

docker compose up --build
```

**Gap histórico, ya resuelto**: este README decía que ningún servicio del `docker-compose.yml` escuchaba en el puerto 9000. Eso quedó desactualizado: existe un servicio `storage` real (`backend (updated)/storage.js`) con su propio healthcheck, autenticado (acepta sesión de cualquiera de los dos dominios JWT, no solo admin), que valida cada archivo subido por sus bytes reales — la misma lógica que usa `/api/uploads` del backend principal. Los tres frontends (`app`, `helpdesk`, `contracts`) ya reciben `NEXT_PUBLIC_UPLOAD_BASE_URL=http://localhost:9000` como build arg apuntando a este servicio. El único ajuste pendiente era el *fallback* que cada frontend usa cuando esa variable no está seteada (ej. `npm run dev` fuera de Docker) — antes caía a `https://ftp.ebadgeid.com`, un dominio externo que este repositorio no puede verificar; ahora cae a `http://localhost:9000`, el mismo servicio real incluido aquí. Un despliegue de producción que sí necesite `ftp.ebadgeid.com` sigue pudiendo usarlo — solo hay que setear la variable de entorno explícitamente.

## Redis (caché + cola de emisión masiva)

`backend (updated)` usa Redis para dos cosas, ambas **opcionales y con degradación explícita, no silenciosa**, si `REDIS_URL` no está configurado:

- **Caché** (`utils/cache.js`) delante de `GET /api/credentials/by-code/:credential_code` — el endpoint público de verificación, el de mayor tráfico externo no controlado. TTL de 60s, invalidado automáticamente al revocar una credencial. Sin `REDIS_URL`, el endpoint simplemente lee MongoDB directo en cada request (el comportamiento de siempre).
- **Cola de emisión masiva** (`queues/bulkIssuanceQueue.js` + `queues/bulkIssuanceWorker.js`, BullMQ) — reemplaza el pool de workers del lado del navegador que existía antes (`Promise.all` con 5 en paralelo en el frontend, que perdía todo el progreso si se cerraba la pestaña a mitad de un lote). Un job por credencial individual, con reintentos y backoff exponencial. Sin `REDIS_URL`, `POST /api/credentials/bulk-issue` devuelve `503` explícito en vez de aceptar un trabajo que nunca se procesaría.

Con `docker compose up`, Redis ya está incluido y conectado (`redis://redis:6379`). **Este código nunca se ejecutó contra un Redis o MongoDB reales en el entorno donde se hizo esta auditoría — se intentó explícitamente y se documenta el motivo exacto abajo, no se oculta.**

Lo que sí se logró en una ronda posterior, sin necesitar Redis real: `utils/cache.js` se reestructuró con un punto de inyección de prueba (`_setClientForTesting`, usado solo en tests, el código de producción nunca lo llama) y se le escribieron 5 tests reales (`tests/cache.test.js`) contra un doble de prueba propio que implementa expiración TTL de verdad — incluye una prueba que espera 1.1 segundos reales de reloj y confirma que el valor expira. Esto prueba la lógica de cache-aside (guardar, leer, invalidar, sobrescribir, expirar) genuinamente, no solo "se salta cuando no hay Redis".

**Lo que se intentó y no se pudo, con evidencia del motivo exacto**: se intentó instalar `mongodb-memory-server` para correr tests de integración con un MongoDB real en memoria (sin necesitar Docker). Falló porque necesita descargar un binario real de `fastdl.mongodb.org`, dominio que no está en la lista de acceso de red de este entorno (confirmado con `curl`: `403`, mientras que `registry.npmjs.org` da `200`) — y MongoDB tampoco está disponible vía los repositorios de Ubuntu accesibles (fue removido de los repos oficiales por licenciamiento). Por la misma razón de red, **BullMQ nunca se probó de punta a punta** (necesita una conexión TCP real a Redis, no solo un binario). Esta limitación es de la red de este entorno específico, no del código — pero se documenta con la misma honestidad que el resto de esta auditoría en vez de inflarse a "verificado".

Como evidencia parcial de comportamiento bajo concurrencia (no equivalente a carga de producción real, pero es evidencia real, no inventada): `scripts/load_test_health.py` dispara N requests concurrentes reales contra `/health` y mide latencia. Corrido en esta sesión: 50 requests concurrentes, 0 errores de conexión, todas respondidas (con `503` honesto porque no hay Mongo real en este entorno — el mismo endpoint respondería `200` con una base de datos real conectada).

## CI

`.github/workflows/ci.yml` corre `npm ci`, `npm audit`, `npm test`, y (en los 3 frontends) `npm run build` en los 5 servicios, en cada push/PR a `main`. Cada paso de este workflow fue reproducido manualmente en este entorno antes de agregarlo — no es un YAML sin probar.

## Estado real del proyecto — léase antes de asumir que "está terminado"

Este proyecto pasó por múltiples rondas de auditoría de seguridad y correctness real (no cosmética) — ver `AUDIT_FIXES.md` para el historial completo, ronda por ronda, con evidencia de cada fix. En resumen: credenciales reales expuestas y rotadas, endpoints que estaban completamente abiertos ahora requieren autenticación y están scopeados por organización (verificado con tokens de dos organizaciones distintas, ver `AUDIT_FIXES.md`), un bug de arranque real (`RESEND_API_KEY` faltante tumbaba todo el proceso), el flujo de emisión de certificados con QR/hash de integridad reparado de punta a punta, un editor visual de plantillas funcional (drag & drop, capas, undo/redo, subida real de imagen/PDF), límites de uso por plan, y una cantidad significativa de código de un producto ajeno ("Soraroam", un servicio de eSIM/roaming) que había quedado mezclado en el chatbot, el backend y varios frontends — encontrado y eliminado por completo.

Lo que sigue sin estar incluido:
- Integraciones LMS reales verificadas contra un tenant (Moodle/Canvas/etc. — el código base existe siguiendo su documentación pública, sin probar contra una cuenta real).
- CDN.
- SSO empresarial.
- ~~Caché distribuido (Redis)~~ y ~~cola de trabajo real para picos de emisión masiva (BullMQ)~~ — **implementados esta ronda**, código verificado por lógica/sintaxis y por comportamiento de degradación en vivo (sin Redis: caché se salta limpio, `bulk-issue` devuelve 503 explícito), **sin verificar contra un Redis real** — ver sección "Redis" más arriba.
- ~~CI/CD~~ — **agregado esta ronda** (`.github/workflows/ci.yml`), cada paso reproducido manualmente antes de escribirlo.
- ~~3 servicios de IA sin conectar~~ — **conectados esta ronda** como fallback real (Gemini → DeepSeek → OpenRouter → OpenAI) en `services/aiGateway.js`, tras corregir que los 3 tenían una identidad de e-commerce/Shopify ajena en vez de la de eBadge ID. Probado en vivo.
- ~~Migración completa de sesión de `localStorage` a cookies `httpOnly`~~ — **completada y re-verificada**: los 3 frontends usan `credentials: 'include'`, sin lectura de token desde `localStorage`.
- Verificación de `docker compose up` contra un entorno con Docker real.

El detalle línea por línea de todo esto está en `AUDIT_FIXES.md`.
