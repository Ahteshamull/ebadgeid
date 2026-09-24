# AI AUDIT — eBadge ID

> **Nota de vigencia**: este reporte es de una ronda anterior a que se construyera `services/aiGateway.js`
> (fallback real Gemini → DeepSeek → OpenRouter → OpenAI, ver "Duodécima ronda" en `AUDIT_FIXES.md`), así
> que la sección "Provider abstraction / AI Gateway — BROKEN/MISSING" de abajo ya no refleja el estado
> actual — se verificó en la ronda de 2026-08-15 que el gateway existe, está conectado desde
> `chatbotController.js`, y los 3 proveedores de respaldo tienen la identidad correcta de eBadge ID (con
> un resto menor corregido, ver hallazgo AUD-H1 de esa ronda). El resto de este documento (alcance de IA,
> el bug de scoping de `detectedLanguage`, la clasificación de cache/retry/token-limits como MISSING)
> sigue vigente. Ver `README.md` para la lista de documentos con el estado actual del proyecto.

## Alcance real

El único componente de IA del sistema es el chatbot de soporte de `help_backend` (widget de chat en vivo + endpoint REST de respaldo). No existe RAG, vector database, embeddings, ni procesamiento batch de documentos en ningún otro punto del sistema — el resto del proyecto (credenciales, verificación, planes) no usa IA en absoluto.

## Provider abstraction / AI Gateway — **BROKEN/MISSING**

`help_backend/services/` contiene 5 archivos de servicio de IA: `geminiService.js`, `deepSeekService.js`, `openaiService.js`, `openRouterService.js`, `metaAI.js` (este último eliminado en esta ronda, ver `DUPLICATION_DEAD_CODE_REPORT.md`).

**Verificado con `grep` en todo el árbol de código**: `chatbotController.js` importa y usa **únicamente** `geminiService.js`. Los otros 3 servicios restantes (`deepSeekService`, `openaiService`, `openRouterService`) no tienen ningún consumidor en `controllers/`, `routes/`, ni `websocket/`.

Esto significa que la arquitectura de "AI Gateway multi-proveedor" que un sistema de nivel producción necesitaría (routing entre modelos, fallback automático si el proveedor principal falla) **no existe realmente** — existe como archivos de código aislados que nunca se invocan. Es un único punto de falla: si Gemini está caído o la API key se agota, el chatbot completo deja de responder, sin ningún camino de respaldo automático.

## Pruebas de resiliencia pedidas por el framework de auditoría

| Prueba | Resultado |
|---|---|
| Proveedor principal disponible | NOT VERIFIED — sin API key real de Gemini con cuota en este entorno |
| Proveedor principal caído / API Key inválida | **VERIFIED (ejecución real)** — con una key inválida (`re_test`/equivalente placeholder), el sistema no crashea: cae al mensaje de respaldo (`generateFallbackResponse`), confirmado con `curl` contra el servidor arrancado |
| API Key agotada | Mismo comportamiento que "inválida" desde la perspectiva del código — sin forma de simular cuota agotada específicamente sin una key real |
| Segunda API Key / fallback provider | **BROKEN/MISSING** — no existe lógica de fallback a otro proveedor, solo el mensaje de respaldo genérico local |
| Cache hit/miss | MISSING — no hay caché de respuestas de IA en ningún punto |
| Límite de tokens/consumo | Existe tracking de costo por sesión (`getAllSessionsCosts` en `geminiService.js`, usado en `/api/system/status`), pero **sin ningún límite que bloquee** el consumo — es solo métrica, no control |

## Bug real encontrado y corregido en esta ronda (no relacionado a IA per se, pero descubierto probando el flujo de IA)

`services/geminiService.js`, función `getResponse()`: la variable `detectedLanguage` se declaraba con `let` **dentro** del bloque `try`, pero se usaba también en su `catch` correspondiente. En JavaScript, `try` y `catch` son bloques de scope separados — una variable `let` declarada en uno no es visible en el otro. Resultado: cada vez que fallaban todos los intentos de llamar a un modelo (exactamente lo que pasa en este entorno sin API key real), el propio código de respaldo crasheaba con `ReferenceError: detectedLanguage is not defined` en vez de devolver el mensaje de respaldo que debía mostrar. **Esto solo se descubrió corriendo el servidor y mandando un mensaje de chat real** — no era detectable leyendo el código de forma estática sin prestar mucha atención al scoping. Corregido moviendo la declaración fuera del `try`. Re-verificado: el mismo request que antes producía un `ReferenceError` en el log ahora devuelve el mensaje de respaldo correcto.

## Contaminación de dominio ajeno (histórico, ya corregido — contexto para esta auditoría)

En una ronda anterior de esta misma auditoría se encontró que el chatbot completo (system prompt de `geminiService.js` en 7 idiomas, intents de `chatbotController.js`, una llamada real a `api.soraroam.com`) estaba diseñado como un asistente de venta de planes de datos eSIM para una empresa de roaming ajena a eBadge ID — no un chatbot de soporte de credenciales. Reescrito por completo en la ronda anterior; esta auditoría confirma que el reemplazo funciona (ver prueba de "proveedor caído" arriba, que ya usa las respuestas de respaldo correctas sobre eBadge ID, no sobre eSIM).

## Clasificación de la integración de IA por dimensión del framework

| Dimensión | Estado |
|---|---|
| Model routing | MISSING |
| Multiple API keys / key rotation | MISSING |
| Provider fallback | **BROKEN** (código existe, cero consumidores, cero lógica de conmutación) |
| Retry | MISSING — un fallo del modelo cae directo al mensaje de respaldo, sin reintento |
| Cache | MISSING |
| Token limits (enforcement) | MISSING (solo tracking, no bloqueo) |
| Cost tracking | **VERIFIED (código)** — presente y expuesto en `/api/system/status` |
| Prompt management/versioning | MISSING — prompts hardcodeados en el archivo de servicio, sin versionado |
| RAG / embeddings / vector DB | N/A — no existe en el sistema, no se pretende que exista |

## Recomendación

No es necesario mantener 3 servicios de IA sin usar "por si acaso". O se invierte en una capa de fallback real (detectar fallo del proveedor principal, reintentar con el segundo definido explícitamente) usando `deepSeekService`/`openaiService`/`openRouterService` como los candidatos ya escritos para eso, o se eliminan para dejar de sugerir una capacidad de resiliencia que hoy no existe. Ver `DUPLICATION_DEAD_CODE_REPORT.md` para la clasificación KEEP/REMOVE de cada uno.
