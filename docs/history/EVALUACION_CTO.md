# eBadge ID — Evaluación técnica (visión de CTO)

Evaluación objetiva del estado real del producto tras las rondas de auditoría y corrección documentadas en `AUDIT_FIXES.md`. No es una lista de lo que se hizo — es la lectura que le daría a un board o a un inversor antes de decidir si esto sale a producción.

---

## 1. Fortalezas actuales

- **El núcleo de negocio (emisión y verificación de credenciales) es sólido y ya fue puesto a prueba de verdad**, no solo revisado: el código arrancó, se le pegó con `curl`, y se corrigieron los bugs que aparecieron corriendo (no solo leyendo). Eso es más confiable que una auditoría puramente estática.
- **Autorización consistente**: un solo sistema de auth, cada ruta administrativa exige sesión y está scopeada por organización — el estado inicial (endpoints completamente abiertos al público) era descalificante para cualquier cliente enterprise; hoy no lo es.
- **Modelo de datos razonable para el dominio**: documentos anidados que evitan joins en la página de verificación pública (que necesita responder rápido y sin fricción) es una decisión de diseño correcta, no un accidente.
- **Higiene de secretos resuelta**: cero credenciales en el código fuente, `.env.example` documentado, rotación necesaria pero el vector de fuga está cerrado.
- **Cultura de tests arrancada, no solo prometida**: 10 tests reales corriendo en CI-ready format (`npm test`), y ya demostraron su valor — uno de ellos destapó un bug que tumbaba el servidor entero al arrancar.

## 2. Qué todavía debe mejorarse (por prioridad)

**Alto impacto, bloqueante para escala:**
1. **Sin capa de servicio/repositorio** — los controladores hablan con Mongoose directamente, mezclando validación, lógica de negocio y acceso a datos. Funciona a la escala actual; se vuelve un problema real en cuanto haya que testear lógica de negocio sin una base de datos levantada, o migrar una sola pieza sin arrastrar todo lo demás.
2. **Sin transacciones en operaciones multi-documento.** Emitir una credencial toca `Users`, `Organization` y `Credentials` sin una transacción — si algo falla a mitad de camino, puede quedar un estado inconsistente. MongoDB soporta transacciones ACID desde hace años (con replica set); no usarlas en el flujo de emisión es una brecha real de integridad.
3. **Sin cola de trabajo para emisión masiva.** El flujo bulk de credenciales (`bulkForm`) procesa un `for` secuencial de llamadas HTTP al servidor de generación de certificados — para 20 credenciales es tolerable, para 2000 se cae o tarda minutos con el usuario mirando una pantalla congelada. Esto necesita moverse a un job en background (cola + webhooks o polling de estado) antes de vender "emisión masiva" como feature real a un cliente grande.
4. **`localStorage` sigue siendo la fuente primaria de sesión** en la mayoría del frontend, aunque la cookie `httpOnly` ya existe y está conectada. Mientras la migración no se complete del todo, un XSS en cualquier página sigue siendo robo de sesión.

**Impacto medio:**
5. **Sin capa de caché.** Cada verificación pública de credencial pega directo a MongoDB. Es aceptable con tráfico bajo; con miles de verificaciones por minuto (el volumen que este informe asume como objetivo) necesita una capa de caché de solo lectura (Redis) delante de las consultas de verificación, que son by definición mucho más lectura que escritura.
6. **Rate limiting es solo por IP.** Para un producto B2B, el límite realista debería ser por API key/organización — un cliente enterprise legítimo con tráfico alto no debería compartir presupuesto de rate limit con el resto de internet, ni un solo actor malicioso detrás de NAT compartido debería poder agotar el límite de usuarios legítimos.
7. **Sin observabilidad real.** `console.log`/`console.error` es lo único que existe. Sin logging estructurado ni métricas exportables (Prometheus/Datadog/lo que sea), diagnosticar un incidente en producción a las 3am es adivinar, no depurar.
8. **`help_backend` y los tres frontends no tienen la misma profundidad de auditoría** que `backend (updated)`. No es que se sepa que tienen bugs — es que no se puede afirmar con la misma confianza que no los tienen.

**Impacto bajo, pero acumulativo:**
9. Nombres inconsistentes (`org_code` vs `organization_code`), la carpeta `backend (updated)` con espacio y paréntesis (rompe cualquier Dockerfile/CI naive), URLs de API repetidas como string literal en varios archivos de `helpdesk_frontend`/`contract` en vez de centralizadas.

## 3. Riesgos técnicos que existen hoy

- **Riesgo de integridad de datos**: sin transacciones, un fallo de red a mitad de la emisión de una credencial puede dejar un registro a medias. Bajo probabilidad por evento, pero con volumen alto se vuelve una certeza estadística, no una hipótesis.
- **Riesgo de disponibilidad bajo carga**: sin cola de trabajo para bulk, sin caché para verificación, y con rate limiting solo por IP, el sistema no tiene ningún mecanismo de absorción de picos de tráfico. Un cliente grande haciendo una emisión masiva de 5000 credenciales el mismo día que hay tráfico normal de verificación puede degradar el servicio para todos.
- **Riesgo de continuidad operativa**: sin logging estructurado ni alertas, un incidente en producción se detecta por un cliente quejándose, no por el equipo. Eso es aceptable en etapa de validación de producto; no lo es a partir del primer cliente enterprise con SLA.
- **Riesgo de superficie no auditada**: `help_backend`, `contract`, y buena parte de `helpdesk_frontend` no pasaron por el mismo nivel de escrutinio. Afirmar "todo está en perfecto estado" sería la mentira más peligrosa que se le podría decir en este momento — lo honesto es: la parte que se audit exhaustivamente está sólida y demostrada; el resto es una incógnita razonablemente acotada, no una garantía.

## 4. Funcionalidades imprescindibles antes de lanzar a clientes reales

En orden de "sin esto no sale":
1. **Cola de trabajo para emisión masiva** (punto 2.3 arriba) — es la funcionalidad que un cliente enterprise va a estresar primero, el día 1.
2. **Transacciones en el flujo de emisión de credenciales** — la integridad de una credencial es literalmente el producto; no se puede vender "verificación confiable" sobre un flujo de escritura que puede quedar a medias.
3. **Logging estructurado + al menos una alerta básica** (errores 5xx, caída de conexión a Mongo) — sin esto, el primer incidente en producción se detecta tarde y se depura a ciegas.
4. **Completar la migración a cookies `httpOnly`** — actualmente es una mejora defensiva a medio camino; hay que terminarla, no dejarla como "también existe".
5. **Rate limiting por organización/API key**, no solo por IP, antes de firmar cualquier cliente con volumen serio.
6. **Auditoría de `help_backend` y los frontends restantes** al mismo nivel que se le dio al backend principal — no por sospecha de bugs específicos, sino porque no se puede vender confianza sobre código que no se verificó con el mismo rigor.

## 5. Qué cambiaría para llevarlo a nivel internacional — miles de organizaciones, millones de credenciales

Esto ya no es "arreglar lo que hay", es la hoja de ruta de arquitectura para el siguiente orden de magnitud:

- **Separar lectura de escritura a nivel de infraestructura.** Verificación pública de credenciales es un patrón de lectura masiva, altísima concurrencia, baja latencia tolerada. Emisión es de escritura, baja frecuencia relativa, tolera más latencia. Con millones de credenciales, estos dos patrones no deberían competir por la misma base de datos primaria — la verificación pública debería servirse desde réplicas de solo lectura o una capa de caché dedicada (Redis/CDN edge para las páginas de verificación, que son esencialmente contenido semi-estático una vez emitida la credencial).
- **Particionar por organización (sharding u organización-como-tenant-lógico) en MongoDB** una vez que el volumen lo justifique — el modelo de datos actual (todo con `organization_code`) ya está preparado para esto sin necesitar un rediseño de schema, solo una estrategia de partición cuando el volumen lo pida.
- **Cola de eventos real (SQS/RabbitMQ/Kafka según el resto del stack) para todo lo asíncrono**: emisión masiva, envío de emails, generación de imágenes de certificado. Ahora mismo todo eso es síncrono dentro del ciclo de request/response, lo cual es exactamente lo que no escala.
- **CDN delante de las imágenes de certificado y de las páginas públicas de verificación** — son el contenido con más tráfico externo y menos necesidad de cómputo por request.
- **Multi-región para el servicio de verificación pública específicamente** (no necesariamente para todo el sistema) — es la parte del producto que ve tráfico de terceros no controlados (empleadores verificando candidatos desde cualquier parte del mundo), y es la que más se beneficia de latencia baja global.
- **SSO/SAML para clientes enterprise** — cualquier organización de cierto tamaño va a pedir integrar su propio Identity Provider en vez de crear usuarios locales; hoy el sistema no tiene ese camino.
- **Auditoría/compliance de nivel empresarial**: logs de auditoría inmutables de quién emitió/revocó qué credencial y cuándo (no solo `createdAt`/`updatedAt, sino un log de eventos append-only) — esto es lo que un comprador enterprise en sectores regulados (educación, salud, finanzas) va a pedir en la due diligence de seguridad antes de firmar, no después.
- **API pública versionada y documentada (OpenAPI/Swagger) con SDKs** si la estrategia de crecimiento incluye que otros sistemas (ATS, LMS) integren contra eBadge ID en vez de solo usar la UI — hoy no existe ninguna documentación de API pública versionada.

---

## Conclusión

El sistema pasó de "inseguro y con funcionalidad rota en el núcleo del producto" a "el núcleo funciona, está probado, y es defendible" en las rondas de esta auditoría. Eso es real y verificable, no marketing. Lo que falta para "nivel internacional" no es deuda técnica oculta — es la brecha esperable y normal entre un producto que funciona correctamente para los primeros clientes y una plataforma diseñada desde el día uno para escala masiva. Esa brecha no se cierra revisando más código; se cierra con las inversiones de infraestructura listadas en la sección 5, en el orden priorizado de la sección 4.
