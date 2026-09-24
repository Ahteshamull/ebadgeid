# DUPLICATION & DEAD CODE REPORT — eBadge ID

Hallazgos de esta ronda (forense, ejecutada tras las rondas de seguridad de dependencias). Cada elemento clasificado KEEP/REMOVE/MERGE según lo pide el framework de auditoría. Todo lo marcado REMOVE ya fue eliminado y re-verificado con build/tests.

## Componentes de frontend completamente huérfanos (0 imports en todo el árbol) — **REMOVE, ejecutado**

Detectado con un barrido sistemático (no manual): por cada archivo en `src/components/`, se buscó su nombre base en el resto del código fuente. Cero coincidencias = huérfano confirmado, no falso positivo (se verificó cada uno individualmente antes de borrar, incluyendo revisar variantes de nombre como PascalCase vs kebab-case).

| Archivo | Servicio(s) | Contenido | Origen probable |
|---|---|---|---|
| `SyllabusDetails.js`, `SyllabusList.js` | frontend, helpdesk_frontend | Gestión de "syllabus" (currícula académica) | Plantilla de gestión escolar ajena — mismo origen que `TopicModal`/`SyllabusModal` eliminados en rondas anteriores |
| `dashboard/recent-transctions.js` (nombre con typo) | frontend, helpdesk_frontend | 305 líneas de "Sample transaction data" — tarjeta de crédito, PayPal, montos en dólares | Plantilla de dashboard de e-commerce/fintech ajena |
| `dashboard/main-chart.js`, `dashboard/recent-activities.js`, `dashboard/user-welcome.js` | frontend, helpdesk_frontend | Widgets de dashboard genéricos | Misma plantilla ajena |
| `layout/theme-toggle.js` | frontend | Selector de tema claro/oscuro, nunca integrado a ningún layout real | Plantilla base de UI |
| `google-translate-provider.js` | frontend, helpdesk_frontend | Provider de traducción, nunca envuelto en ningún `layout.js` | Desconocido — posiblemente un experimento abandonado |
| `layout/googleTranslateWidget.js` | helpdesk_frontend | Widget de traducción visual | Mismo caso |
| `chatWidget.js` | helpdesk_frontend | **Hallazgo más importante de este grupo**: una implementación completa y duplicada del widget de chat en vivo, con su propia conexión WebSocket. Existe una SEGUNDA implementación real y en uso (`CustomerChatWidget`, definida inline dentro de `src/app/page.js`) que es la que de verdad se sirve a los usuarios. Se verificó que la versión en uso ya apunta correctamente a `wss://hapi.ebadgeid.com` (corregido en una ronda anterior) — el archivo huérfano no representa un bug en producción, pero sí un riesgo real de mantenimiento: alguien podría editar el archivo equivocado creyendo que arregla el chat en vivo real, sin efecto alguno. | Duplicación accidental durante el desarrollo original |

**Total eliminado**: 8 archivos en `frontend`, 9 en `helpdesk_frontend` (17 archivos). Verificado con una segunda pasada del mismo barrido tras la eliminación: cero huérfanos en cascada (ningún componente eliminado era, a su vez, el único consumidor de otro componente que ahora quedara huérfano). **Build de producción re-ejecutado en ambos servicios tras la eliminación: exit code 0 en los dos.**

## Endpoint duplicado con datos inventados no detectado en rondas anteriores — **REMOVE (datos falsos), ejecutado**

`help_backend/routes/authRoutes.js`, handler de `GET /agents/available`: devolvía `currentChats: 0` y `responseTime: '< 2 minutes'` **hardcodeados para cada agente**, sin relación con carga real. Este es el mismo patrón de "métrica de apariencia real pero inventada" corregido en `authController.js`/`getActiveAgents` en una ronda anterior — pero este handler específico, definido inline en el archivo de rutas (no en el controlador), se pasó por alto entonces porque es una implementación separada del mismo concepto ("agentes disponibles"), no la misma función reutilizada. Corregido con el mismo criterio: `null` explícito en vez de un número inventado.

## Servicios de IA sin consumidor — clasificación KEEP/REMOVE

Ver detalle de pruebas en `AI_AUDIT.md`. Resumen de clasificación:

| Servicio | Consumidores reales | Vulnerabilidades que traía | Clasificación |
|---|---|---|---|
| `geminiService.js` | `chatbotController.js` (real) | 0 | **KEEP** |
| `deepSeekService.js` | 0 | 0 conocidas hoy | **REVISAR** — candidato natural para fallback real si se decide construirlo; si no, REMOVE |
| `openaiService.js` | 0 | 0 conocidas hoy | **REVISAR** — mismo caso |
| `openRouterService.js` | 0 | 0 conocidas hoy | **REVISAR** — mismo caso |
| `metaAI.js` | 0 | Cadena completa de `@xenova/transformers` → `sharp`/`onnxruntime`, incluyendo 1 CRITICAL | **REMOVE, ejecutado** — a diferencia de los otros 3, este traía una vulnerabilidad crítica real activa solo por existir, sin aportar ninguna funcionalidad. No hay ambigüedad aquí: se eliminó junto con la dependencia. |

## Dependencias npm sin consumidores, con vulnerabilidades — **REMOVE, ejecutado**

Detalle completo de la evidencia (fechas, comandos, resultados de `npm audit`) en `SECURITY_AUDIT.md`, sección 11. Resumen de qué se eliminó por no tener ni un solo uso real en el código, confirmado con `grep`:

| Paquete | Servicio(s) | Vulnerabilidades que traía |
|---|---|---|
| `sooner` (typo de `sonner`, paquete real y distinto) | frontend, helpdesk_frontend | 15-16 CRITICAL cada uno |
| `xlsx` | frontend, helpdesk_frontend, contract (declarado, sin uso) | HIGH, sin parche del mantenedor |
| `html2pdf`, `html2pdf.js` | frontend, helpdesk_frontend | 1 CRITICAL |
| `react-syntax-highlighter` | helpdesk_frontend | MODERATE |

## Lockfiles conflictivos — **REMOVE, ejecutado**

`pnpm-lock.yaml` / `pnpm-workspace.yaml` en `backend (updated)`, `help_backend`, `frontend`, `helpdesk_frontend`, `contract` — desactualizados (hasta 4 días respecto a `package-lock.json`, sin las dependencias reales agregadas después) y conviviendo con `npm`, el gestor de paquetes realmente usado por los 5 Dockerfiles. Detalle en `DOCKER_INFRASTRUCTURE_AUDIT.md`.

## Modelos/rutas duplicadas — **KEEP (sin hallazgos)**

Se verificó explícitamente que ningún modelo de Mongoose está registrado dos veces con `mongoose.model()` (causa un crash real en Node si ocurre) en ninguno de los dos backends — cero duplicados encontrados.

## Nota metodológica

Este reporte prioriza duplicación y código muerto con **impacto real** (vulnerabilidades de seguridad activas, riesgo de mantenimiento genuino, datos inventados servidos a usuarios) por sobre una lista exhaustiva de cada import sin usar — dado el tamaño del repositorio (230 archivos `.js` fuera de `node_modules`), una auditoría de ese nivel de detalle sobre cada línea excede el alcance razonable de esta sesión. Lo no cubierto aquí (variables locales sin usar, imports de un solo componente de UI no utilizado dentro de un archivo por lo demás activo) es deuda técnica de bajo impacto, no un riesgo de producción.
