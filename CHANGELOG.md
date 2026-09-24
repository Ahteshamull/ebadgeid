# Changelog

El historial detallado de todas las rondas anteriores está en `AUDIT_FIXES.md`. Este changelog arranca desde la ronda de Credential Studio, en el formato pedido (Added/Changed/Fixed/Security/Tests/Known limitations).

## Credential Studio — Fase 1 (parcial): manijas de transformación

### Added
- Manijas visuales de resize (4 esquinas) y rotate para formas e imágenes en el editor de plantillas.
- Shift + resize → conserva proporción.
- Shift + rotate → snapping de 15°.
- Ctrl/Cmd+D → duplicar el elemento seleccionado.
- Delete/Backspace → borrar el elemento seleccionado (con guard para no interferir al escribir texto).

### Changed
- Nada del comportamiento existente cambió — el guardado numérico en el panel lateral se mantiene sincronizado con las nuevas manijas.

### Fixed
- N/A (esta ronda no corrigió bugs, agregó funcionalidad nueva).

### Security
- Sin cambios de superficie de seguridad — interacción puramente de cliente sobre datos ya validados al guardar.

### Tests
- 18/18 tests existentes del frontend, sin regresiones.
- 159/161 tests del backend, sin cambios (backend no se tocó esta ronda).
- Verificación manual real en navegador, documentada con evidencia exacta en `CREDENTIAL_STUDIO_REPORT.md`.

### Known limitations
- Solo Fase 0 (auditoría) y una porción de Fase 1 de la misión "Credential Studio" completa — ver `CREDENTIAL_STUDIO_REPORT.md` sección 12 y 13 para el detalle exacto de qué falta.

## Estado Borrador/Publicado + Compartir en LinkedIn

### Added
- Campo `status` (`draft` | `published`) en el modelo de plantillas (`models/designSchema.js`). Toda plantilla nueva se guarda como `draft` (`controllers/designController.js`, `createDesign`) — antes cualquier plantilla guardada, terminada o no, ya podía usarse para emitir credenciales.
- `POST /api/designs/:design_code/publish` y `/unpublish` (solo admin, solo de su propia organización) — la única forma de que una plantilla pase a estar disponible para emitir.
- Gate real en `certificateController.generateCertificate`: rechaza con `409` ("This template is still a draft...") si la plantilla no está publicada. Cubre también la emisión masiva (`queues/bulkIssuanceWorker.js` llama al mismo controller, sin código adicional).
- `GET /api/designs/public/:design_code` — lectura pública, sin autenticación, de una plantilla PUBLICADA únicamente (404 idéntico para "no existe" y "es borrador", nunca expone `organization_code`). Backea la nueva página pública `frontend/src/app/templates/preview/[design_code]/page.js`.
- Botón "Share" en el editor (`frontend/src/app/credentials/design-editor/page.js`), visible solo si la plantilla está guardada y publicada, que abre el intent `linkedin.com/sharing/share-offsite` apuntando a esa página pública — mecanismo distinto e independiente del "Add to LinkedIn profile" que ya existía para credenciales emitidas.
- Badge de estado (Draft/Published) y botón Publish/Unpublish en el editor y en la lista lateral de plantillas.

### Fixed
- Bug potencial detectado y corregido antes de llegar a producción: `certificateController.js` lee el diseño con `.lean()`, que NO aplica el `default` del schema — sin la migración de backfill, toda plantilla ya existente (sin el campo `status` guardado) se habría bloqueado retroactivamente al implementar el gate. Solucionado con (1) migración idempotente `20260821_backfill_design_status_published` en `scripts/migrate.js` y (2) chequeo defensivo `design.status && design.status !== 'published'` en el gate mismo.

### Security
- La ruta pública nunca expone `organization_code`, y trata "no existe" y "es borrador" de forma idéntica (404) para que no se pueda enumerar contenido de borradores ajenos.

### Tests
- 12 tests de integración nuevos, reales, contra el Express app real y MongoDB real (`tests/designPublishing.integration.test.js`): draft bloquea emisión (409), publish la habilita, unpublish la vuelve a bloquear, una plantilla legacy sin `status` NO se bloquea retroactivamente, la migración hace backfill y es idempotente, y la vista pública oculta borradores y nunca filtra `organization_code`.
- Suite completa del backend: 171/173 (2 skipped, sin relación con este cambio) — 0 regresiones sobre la línea base de 159/161 + 12 nuevos.
- Frontend: build de producción sin errores, 18/18 tests existentes sin regresiones.
- Verificación manual real en navegador contra el stack completo en docker-compose (datos reales en MongoDB, no mockeados): se corrió la migración real (detectó y corrigió 2 plantillas preexistentes sin `status`), se hizo login real, se publicó/despublicó una plantilla real y se confirmó el cambio de badge y de disponibilidad del botón Share, se interceptó `window.open` para confirmar la URL exacta del intent de LinkedIn, y se cargó la página pública `/templates/preview/:design_code` confirmando que renderiza título/organización/elementos reales y nunca expone `organization_code`.

### Known limitations
- El intent de LinkedIn (`share-offsite`) solo se verificó construyendo y abriendo la URL correcta — no se completó un posteo real en LinkedIn (requeriría una cuenta real y salir del entorno de pruebas).
- La página pública de preview no renderiza el QR (es un placeholder de todos modos en el editor); solo fondo, texto, formas e imágenes.

## Accesibilidad/responsive real + bug real de chatbot degradado + Credential Studio: 6 features priorizadas

### Fixed
- **Bug real en el chatbot degradado**: sin ningún proveedor de IA configurado (o si todos fallan), un usuario que escribía en español/francés/alemán/italiano/portugués/árabe en su primer mensaje recibía la respuesta de emergencia en inglés — `getSessionLanguage` devolvía 'english' a secas para toda sesión sin historial real todavía, en vez de detectar el idioma del mensaje actual. Corregido en `help_backend/services/geminiService.js` + 3 puntos de llamada en `chatbotController.js`/`aiGateway.js`. 5 tests nuevos y reales.
- **Bug real, severo, encontrado durante la auditoría de accesibilidad**: la página `/credentials` ("Manage Credentials") llamaba a la API con el organization_code literalmente `undefined` en cada carga (una condición de carrera con `useSession()`), y el backend rechazaba eso con 403 — lo que redirigía a CUALQUIER admin de vuelta al login antes de que la página cargara, siempre. Corregido con guards en `fetchCredentials`/`fetchDesigns` y agregando `organizationCode` a las dependencias del efecto. Confirmado en vivo en el navegador.
- 20 violaciones reales de accesibilidad encontradas con `axe-core` contra la app real corriendo (10 combinaciones de página × viewport, desktop y mobile) — todas corregidas, 0 violaciones confirmado en el re-scan: botones sin nombre accesible, campo sin label, contraste de color insuficiente, regiones con scroll no alcanzables por teclado, falta de `<h1>`, orden de encabezados inválido, contenido fuera de cualquier landmark, y `<main>` duplicado/anidado en el editor.
- **Brecha real descubierta al probar en mobile**: la barra lateral no tenía ningún comportamiento responsive — un panel fijo de 320px que ocupaba casi toda la pantalla en un viewport de celular, empujando el contenido real fuera de la vista. Se construyó un drawer real (botón hamburguesa, fondo semitransparente, botón de cerrar, se cierra solo al navegar), verificado en vivo — desktop queda exactamente igual que antes.

### Added — Credential Studio, 6 funcionalidades priorizadas de las Fases 2-5
- **Estado "Archived"**: tercer estado además de Borrador/Publicado. Oculto de la lista por defecto (`GET /designs/organization/:code`, con `?include_archived=true` para verlo), bloqueado para emisión igual que un borrador (mismo gate 409, sin código adicional). Restaurar siempre vuelve a Borrador, nunca directo a Publicado.
- **Duplicar plantilla completa** (`POST /designs/:code/duplicate`): clona fondo, textos, formas, imágenes y QR en una plantilla nueva con su propio design_code, siempre como borrador — distinto de duplicar un solo elemento dentro del lienzo, que ya existía.
- **Copy/Paste (Ctrl+C / Ctrl+V)**: complementa a Duplicate (Ctrl+D) — copia una vez, pega las veces que haga falta, cada pegado con más desplazamiento que el anterior pero siempre relativo al original copiado, no acumulado pegado-sobre-pegado.
- **Pines de comentario visibles en el lienzo**: el backend ya guardaba una posición X/Y en cada comentario, pero nada la mostraba. Ahora hay un modo "clic para anclar", el pin se dibuja en el lienzo en la posición exacta, y clickearlo abre un popover con el texto y los botones de resolver/borrar.
- **Manijas de borde medio** (arriba/abajo/izquierda/derecha): redimensionan un solo eje por vez (antes solo había 4 esquinas, que siempre cambiaban ancho y alto juntas).
- **Alt/Option + redimensionar = desde el centro**: aplica tanto a las esquinas como a los bordes medios — el centro del elemento queda matemáticamente fijo (verificado con lectura directa del DOM: coincide exacto, sin ningún error de redondeo).

### Tests
- Backend: 176/178 (2 skips preexistentes) — 171 + 5 tests nuevos de archive/unarchive/duplicate, 0 regresiones.
- help_backend: 20/20 — 15 + 5 tests nuevos del fallback de idioma, 0 regresiones.
- Frontend: build de producción limpio, 18/18 tests existentes sin regresiones.
- Accesibilidad: 0 violaciones de `axe-core` en 10 combinaciones de página × viewport, confirmado con un re-scan real después de cada tanda de correcciones (no solo una vez al final).
- Verificación manual real en navegador para cada una de las 6 funcionalidades del editor: manija de borde media arrastrada con matemática exacta confirmada leyendo el DOM real (ancla fija, solo un eje cambia), Alt+resize con el centro exacto confirmado (500.5, 300) antes y después del resize, Copy/Paste con offsets 16/32/48 confirmados, Archive → oculto de la lista → "Show archived" lo revela → Restore → vuelve a Draft, Duplicate → nuevo design_code, carga automática en el editor, Comment pin → clic en modo pin → posición exacta capturada → posteado → pin visible en el lienzo → popover con resolver funcionando.

### Known limitations
- De las ~13 funcionalidades de las Fases 2-5 de la misión "Credential Studio" original, esta ronda cerró las 6 de mayor impacto (decisión explícita del usuario). Sigue pendiente: Brand Kit, biblioteca de plantillas ampliada, preview integral antes de emitir, approval workflow, autosave, campos dinámicos/custom fields, compartir con otra organización dentro del sistema, edición simultánea con cursores en vivo (marcada como fase Enterprise futura).
- SAML y LMS reales siguen sin poder probarse en vivo — necesitan un Identity Provider y un LMS reales, respectivamente (no una clave de API suelta), que nadie ha provisto todavía.

## Chatbot/RAG con IA real + Email real — credenciales reales provistas y verificadas en vivo

### Fixed
- **Modelo gratuito de OpenRouter discontinuado**: `help_backend/services/openRouterService.js` tenía un solo modelo hardcodeado (`google/gemma-2-9b-it:free`) que OpenRouter ya no sirve — confirmado con un 404 real ("No endpoints found") al probarlo con la API key real recién provista, no algo que se hubiera detectado leyendo el código. Actualizado contra el catálogo real y vigente de OpenRouter (`GET /api/v1/models`), y ampliado a 3 modelos de respaldo en vez de uno solo.
- **Bug real encontrado en el mismo momento**: al fallar el primer modelo con un 429 (límite de uso alcanzado — normal en el nivel gratuito compartido de OpenRouter), el código devolvía el mensaje de "mucho tráfico" de inmediato, sin intentar los otros modelos de la lista — el mecanismo de respaldo nunca llegaba a usarse. Corregido para que un 429 caiga al siguiente modelo exactamente igual que un 404 ya lo hacía. Confirmado en vivo: una prueba real hizo fallar 2 modelos seguidos con 429 y el tercero respondió correctamente.
- **Timeout de `aiGateway.js` demasiado corto para el nivel gratuito**: 8 segundos alcanzaba para un solo proveedor de pago, pero no para que OpenRouter probara varios modelos gratuitos en cadena — medido en vivo, una respuesta real y correcta tardó ~34s en llegar y el límite de 8s la cortaba antes de tiempo, mostrando la respuesta degradada aunque la IA real ya casi había contestado. Subido a 25s.

### Verified — con las credenciales reales que se proveyeron
- **IA real (OpenRouter)**: se configuró la API key real y se probó de punta a punta contra la API real de OpenRouter — primero aisladamente (`aiGateway.getResponse`, sin ninguna otra clave configurada), y después contra el flujo completo real: `POST /api/chat/session/start` + `POST /api/chat/message` del servidor corriendo de verdad en Docker, con una organización real. La respuesta fue generada por el modelo real (no la respuesta de emergencia), coherente y relevante a la pregunta.
- **Email real**: se configuró el SMTP real (verificado primero con `transporter.verify()` contra 4 combinaciones de host/puerto antes de elegir la correcta) y se envió un correo real a través de la función real de la app (`sendWelcomeEmail`, la misma que usa el flujo de alta de usuarios) — el servidor de correo lo aceptó de verdad (`250 OK`, con Message-ID real). No se inició sesión en el webmail para revisar la bandeja de entrada (eso hubiera significado escribir la contraseña en un formulario de un sitio externo, algo que este asistente no hace) — la confirmación es la respuesta real del propio servidor SMTP al aceptar el mensaje.

### Tests
- help_backend: 21 (20 + 1 nuevo) — el nuevo test verifica una respuesta real de OpenRouter cuando hay una key configurada, y se salta limpiamente (no falla) cuando no la hay, mismo patrón que los tests de LMS/certificado ya usaban para dependencias externas reales. 0 regresiones.

### Security
- Las credenciales reales provistas quedaron únicamente en los archivos `.env` locales (ya excluidos de git y del .zip de entrega) — nunca se escribieron en el código, en tests, ni en ningún documento de este repositorio.

## SAML real contra Microsoft Entra ID — bug de routing real encontrado y corregido

### Fixed
- **Las rutas SAML nunca eran alcanzables en la URL que un IdP realmente registra**: `PUBLIC_APP_URL` (el origen del frontend, ej. `http://localhost:3000`) es lo que se usa para construir el Entity ID y el ACS URL — exactamente lo que un admin de Entra ID/Okta configura del otro lado — pero las rutas SAML solo existen en el backend (otro servicio, otro puerto), y nada las proxeaba. Confirmado con una petición real: `POST http://localhost:3000/api/auth/saml/<org>/acs` (la URL exacta ya registrada en un tenant real de Microsoft Entra ID) devolvía la página 404 del propio Next.js — la autenticación fallaría siempre en el último paso, sin importar HTTPS. Corregido con un rewrite dedicado en `next.config.mjs` (`/api/auth/saml/*` → el backend real), sin tocar el resto de `/api/*`, que ya funciona vía `NEXT_PUBLIC_API_BASE_URL`.
- **Segundo bug real encontrado al verificar el fix**: la primera versión del rewrite usaba una variable de entorno de runtime (`environment:` en docker-compose) — pero Next.js resuelve `rewrites()` una sola vez durante `next build`, no en cada arranque del contenedor ni en cada request. La variable quedaba embebida con su valor de build (el fallback a `localhost`), aunque `docker exec ... env` mostrara el valor correcto adentro del contenedor corriendo. Corregido moviendo la variable a un build arg real (`Dockerfile` + `docker-compose.yml`), igual que ya se hace con `NEXT_PUBLIC_API_BASE_URL`.

### Verified — con un tenant real de Microsoft Entra ID
- Se configuró la organización `editor-test-org-784657` con los 3 datos reales del IdP real (Entity ID, SSO URL, certificado X.509) a través del endpoint real (`PUT /api/auth/saml/config`), no un insert directo a la base.
- `GET /metadata` y `GET /login` verificados contra la URL exacta registrada en Entra ID (puerto 3000, no el backend directo) — antes del fix, 404; después del fix, 200 y 302 reales.
- El `AuthnRequest` real que genera `/login` se decodificó a mano (base64 + inflate) y se confirmó que su `Destination`, `AssertionConsumerServiceURL` e `Issuer` coinciden exactamente con lo registrado en Entra ID.
- El ACS con una respuesta SAML inválida devuelve 400 (rechaza de verdad, no explota ni acepta cualquier cosa) — confirma que la validación de samlify está activa.
- **Lo que no se completó, explícitamente**: el login interactivo real (usuario autenticándose en Microsoft con sus credenciales reales) no se ejecutó — requiere que el usuario lo haga en su propio navegador con su propia cuenta; este asistente no introduce contraseñas reales en formularios de sitios externos. Todo lo demás en la cadena (generación de metadata/AuthnRequest, routing del ACS, validación de la respuesta) está verificado con ejecución real.

### Tests
- Frontend: build de producción limpio, 18/18 tests existentes sin regresiones. Backend no se tocó en este fix (solo se escribió configuración real vía su propio endpoint).

## CORS bloqueaba el ACS real de Microsoft Entra ID — encontrado por el usuario en un login real, corregido y verificado

### Fixed
- **Dos checks de Origin independientes, ambos bloqueando el ACS**: `backend (updated)/api.js` tenía (1) el middleware `cors()` con un allowlist estricto (`ALLOWED_ORIGINS`) y (2) un segundo chequeo de Origin separado (defensa CSRF en cada request mutante de `/api/*`), ninguno de los dos con excepción para el ACS SAML. El navegador del usuario, al completar el login real en Microsoft, mandó el POST del `SAMLResponse` con `Origin: https://login.microsoftonline.com` — un origen que ninguno de los dos allowlists tenía razón de conocer. El primer check lo rechazaba con `{"message":"Not allowed by CORS"}`; con ese corregido, el segundo lo seguía rechazando con `{"message":"Request origin is not allowed"}` (encontrado recién al verificar el primer fix contra el ACS real — no se vio hasta probarlo).
- **Por qué esto nunca debió depender de CORS en primer lugar**: el POST del IdP al ACS es una navegación de nivel superior (un `<form>` HTML que la propia página de Microsoft envía), no un `fetch()`/XHR — los headers `Access-Control-*` solo controlan si JavaScript puede *leer* una respuesta cross-origin, nunca si una navegación/POST de formulario cross-origin llega al servidor o se procesa. La verdadera frontera de seguridad de este endpoint siempre fue la verificación criptográfica de la firma de la aserción contra el `idp_certificate` guardado (`services/samlAuth.js`), no el header Origin — confirmado que sigue 100% intacta: la misma prueba que antes daba el error de CORS ahora, con datos falsos, da `400` desde la validación real de samlify (no un 200 falso).
- **Corrección mínima y acotada**: excepción agregada en los dos puntos, únicamente para `/api/auth/saml/:organization_code/acs` (regex `samlAcsPathPattern`), usando reflejo de origen (`origin: true`, nunca el literal `*`) solo en ese path. El resto de `/api` (probado explícitamente con una ruta real no relacionada) sigue rechazando orígenes desconocidos exactamente igual que antes.
- **Detalle de implementación que costó una vuelta extra**: el segundo check está montado con `app.use('/api', ...)` — dentro de ese middleware, `req.path` ya viene sin el prefijo `/api` (Express lo recorta en middlewares montados con prefijo), así que el primer intento de la excepción ahí nunca coincidía. Corregido usando `req.originalUrl` (siempre la ruta completa, sin importar el punto de montaje) en los dos lugares.

### Verified
- Con ejecución real: se simuló exactamente el escenario que falló (`Origin: https://login.microsoftonline.com` en el POST al ACS) — antes del fix, error de CORS; después, la petición llega a la validación SAML real.
- `GET /metadata` sigue en 200, `GET /login` sigue redirigiendo 302 al tenant real de Microsoft — sin cambios.
- Una ruta mutante real no relacionada (`POST /api/auth/login`) con un origen desconocido sigue rechazada exactamente igual que antes — la excepción no se filtró al resto de la API.
- 2 tests nuevos agregados a `tests/samlSso.integration.test.js` (con una aserción real, firmada criptográficamente, igual que el resto del archivo) — uno prueba el fix exacto (login real con Origin extranjero → 302 con `sso=success`), el otro protege que el resto de `/api` no se debilitó. 178/180 tests del backend (176 + 2 nuevos, 2 skips preexistentes), 0 regresiones.
- **Todavía no considerado validado de punta a punta**: falta que el usuario repita el login real en su navegador y confirme que termina en `/?sso=success`.

## Conflicto de puerto 5000 (AirPlay/ControlCenter) — el login SAML real terminaba en /auth/login

### Fixed
- **El backend SAML funcionó perfecto — el problema estaba un paso después**: el usuario repitió el login real con Microsoft Entra ID después del fix de CORS y ya no vio el error, pero terminó en `/auth/login` en vez de `/?sso=success`. Los logs del backend confirmaron la cadena completa exitosa (`POST .../acs → 302`, `sso_user_provisioned` con el email real que devolvió Microsoft: `tara@capacitacionestara.onmicrosoft.com`, perfil creado, JWT emitido, cookie seteada con el `Set-Cookie`/`Location` correctos — verificado reproduciendo la misma respuesta con una aserción propia). El problema real: el frontend estaba compilado con `NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api`, y en esta Mac el puerto 5000 lo tiene tomado ControlCenter/AirPlay, no la app — la comprobación de sesión inmediatamente después del login (`GET /api/auth/me`) nunca llegaba al backend real (confirmado con Network real del navegador: `OPTIONS http://localhost:5000/api/auth/me → 403`, `net::ERR_FAILED`), y `apiFetch` — por diseño, ante un fallo ahí — mandaba de vuelta a `/auth/login`.
- **Reproducido con un navegador real antes de tocar nada**: un formulario auto-enviado desde un origen distinto (mismo mecanismo que la página de Microsoft) contra una aserción SAML propia, firmada de verdad, dio el mismo síntoma exacto. Con el frontend apuntando al puerto correcto, el mismo flujo terminó autenticado de verdad en el dashboard — confirmando la causa antes de proponer el cambio.
- **Cambio aplicado**: `docker-compose.yml` — el mapeo de puerto del backend (`5050:5000`, ya necesario por el mismo conflicto de AirPlay) pasa a ser permanente y documentado, y `NEXT_PUBLIC_API_BASE_URL` del servicio `app` se actualiza a `http://localhost:5050/api` para que coincida siempre. No se tocó ningún otro servicio (`helpdesk`, `contracts` no están en uso en este flujo).

### Verified
- Cero referencias a `localhost:5000` en el JS estático compilado del frontend (`grep` sobre `.next/static` dentro del contenedor); 19 archivos con la referencia correcta a `localhost:5050`.
- Preflight OPTIONS y GET real a `/api/auth/me` contra el puerto correcto: 204 y 401 reales (no error de red).
- `/metadata` sigue en 200 y `/login` sigue redirigiendo 302 al tenant real de Microsoft, sin cambios.
- Flujo SAML completo repetido con un navegador real (mismo mecanismo de formulario cross-origin, aserción propia firmada) — esta vez con la sesión persistiendo: `GET http://localhost:5050/api/auth/me → 200 OK`, dashboard real cargado con el usuario SSO autenticado.
- Login tradicional (usuario/contraseña) probado en vivo, sin regresiones — dashboard real cargado.
- Backend 178/180 (2 skips preexistentes), frontend 18/18 — 0 regresiones.

### Fixed (accidental, durante esta misma ronda)
- Al limpiar el entorno de prueba se ejecutó por error un `db.designs.deleteMany({})` que borró las 2 plantillas reales de rondas anteriores ("Version Two Title", "Final Audit Cert"). Reparado de inmediato reconstruyendo ambos documentos desde su historial real de versiones (`designversions`, no tocado), con el mismo `_id` y contenido exacto — no se inventó ningún dato. Comunicado al usuario de forma transparente en el momento en que ocurrió.

### Validado de punta a punta
- El usuario repitió el login real con Microsoft Entra ID desde Chrome (su propia cuenta, `tara@capacitacionestara.onmicrosoft.com`) y confirmó con una captura real: sesión autenticada, organización correcta (`editor-test-org-784657`), aterrizando en `/user_dash` — el destino esperado para una cuenta SSO (rol `user`) tras pasar por `/?sso=success`. SSO SAML 2.0 contra Microsoft Entra ID queda validado de extremo a extremo con ejecución real, no solo por lectura de código.

## LMS real — servidor de prueba real + bug real de emisión encontrado y corregido

### Fixed
- **Bug real, no específico de LMS**: `certificateController.js` resolvía `template_url` y `font_url` a su dirección interna (`internalTemplateUrl()`, para que el microservicio de certificados —que solo puede alcanzar `storage` dentro de la red de docker, no `localhost`— pueda cargarlos) pero nunca hacía lo mismo con las imágenes decorativas colocadas en el diseño (`design.images`). Confirmado en vivo: cualquier plantilla con una imagen colocada (biblioteca de assets o generada por IA) fallaba al emitir con 502 ("Certificate image element rejected" en el microservicio real) — encontrado al probar la emisión real vía LMS, pero afecta la emisión individual y la masiva exactamente igual, ya que las tres comparten el mismo `generateCertificate`.
- Corregido aplicando la misma `internalTemplateUrl()` a cada imagen del array, igual que ya se hacía con el fondo y las fuentes.

### Added — verificado con un servidor de prueba real, no un mock en el mismo proceso
- Se armó un servicio HTTP real e independiente (su propio contenedor, en la red de docker) que habla exactamente el contrato genérico que `services/lmsSync.js` ya esperaba (`GET /completions?since=<ISO8601>`, Bearer auth, mismo formato de respuesta) — no una marca de LMS conocida, pero una prueba real de la lógica de reintentos/autenticación/idempotencia contra la red real.
- **Lado pull (`scripts/syncLms.js`)**: corrida real contra este servidor — 2 finalizaciones de curso reales, 2 credenciales reales emitidas (con imagen decorativa incluida, gracias al fix de arriba), idempotencia real verificada dos veces: (1) una segunda corrida respetando `since` no vuelve a buscar nada, (2) forzando que el LMS "reenvíe" las mismas 2 finalizaciones (simulando un LMS con filtrado imperfecto), la app las reconoce como ya procesadas y no duplica ninguna credencial.
- **Lado push (`POST /api/lms/webhook/course-completed`)**: probado con una API key real generada por el propio endpoint del sistema — una finalización real emite una credencial real; reenviar el mismo `external_event_id` (un retry típico de un LMS real) devuelve `already_processed` sin duplicar; una API key inválida se rechaza con 403.
- Nuevo test real agregado (`tests/certificateGeneration.integration.test.js`, mismo patrón "se salta limpio si el microservicio no está" que ya usaban los tests de LMS) que confirma específicamente que una imagen colocada ya no rompe la emisión — corrido en vivo contra el microservicio real: pasa.

### Tests
- Backend: 178/181 (3 skips que necesitan infraestructura real no incluida en la corrida estándar — 2 preexistentes + el nuevo test de este fix), 0 regresiones.

## Credential Studio — las 7 funcionalidades restantes: Brand Kit, biblioteca ampliada, preview real antes de emitir, aprobación, autosave, campos dinámicos, compartir entre organizaciones

### Added
- **Brand Kit** (`models/organizationBrandKit.js`, `controllers/brandKitController.js`, `GET`/`PUT /api/brand-kit`): color primario/secundario + logo por organización. Nueva pestaña "Brand Kit" en `settings/page.js`. En el editor de plantillas, quick-picks de los dos colores en el selector de color de texto y un botón "Insert brand logo" en la biblioteca de assets — ambos leen el brand kit real de la organización, no lo aplican automáticamente a nada existente.
- **Biblioteca de plantillas ampliada**: 6 plantillas nuevas (`elegant-emerald`, `bold-crimson`, `tech-gradient`, `academic-navy`, `star-badge`, `ribbon-seal`) agregadas a `frontend/src/lib/template-library.js` — de 6 a 12 en la galería "Start from a template". Verificado en navegador real: las 12 aparecen y cargan al canvas correctamente.
- **Preview real antes de emitir** (`credentials/page.js`, emisión individual): el botón "Issue Credential" pasó a ser un flujo de dos pasos — "Preview Certificate" genera la imagen real (mismo `generateCertificate` que la emisión final, no una aproximación) y la muestra completa antes de confirmar; "Confirm & Issue" reutiliza exactamente esa imagen y ese `credential_code` ya reservado, nunca vuelve a renderizar. "Back" descarta el preview sin emitir nada.
- **Approval workflow**: nuevo estado `pending_review` en `models/designSchema.js` (entre `draft` y `published`), más `submitted_by`/`submitted_at`/`reviewed_by`/`reviewed_at`/`rejection_reason`. `submitForReview`/`approveDesign`/`rejectDesign` en `controllers/designController.js` — `approveDesign`/`rejectDesign` rechazan con 403 si quien aprueba/rechaza es la misma persona que envió a revisión. Camino alternativo al Publish directo existente, no lo reemplaza. Botones nuevos en el editor (`design-editor/page.js`) que aparecen según el estado.
- **Autosave** (`design-editor/page.js`): guardado automático debounced (2.5s de inactividad) para plantillas ya guardadas (con `design_code`) — una plantilla nueva sin guardar todavía sigue necesitando el primer Save manual, a propósito. Reutiliza la misma función `saveTemplate` que el botón manual, nunca diverge del guardado explícito.
- **Campos dinámicos / custom fields**: el editor ahora tiene un tercer "Field type" — "Custom field (a different value per issuance)" — donde el admin define una clave libre (`text_title`, ej. `course_name`) y un texto por defecto. Backend: `utils/customFields.js` (sanitiza/valida, descarta silenciosamente la clave `recipient_name`), consumido por `certificateController.generateCertificate` (sustituye el texto en el render real) y `credentialController.createCredential` (persiste `custom_fields` en el credential emitido, nuevo campo en `models/credentialSchema.js`). Enhebrado también por `bulkIssuanceWorker`/`bulkIssuanceQueue` y ambos lados de LMS (webhook y sync) para paridad total. En `credentials/page.js`, el formulario de emisión individual renderiza un input por cada campo dinámico real de la plantilla elegida — deliberadamente excluye los campos `custom` (texto estático, ver "Fixed" abajo).
- **Compartir entre organizaciones**: `models/designShare.js`, `controllers/designShareController.js`, `POST /api/design-shares`, `GET /sent`/`/received`, `DELETE /:share_id`, `POST /:share_id/import`. Compartir solo da visibilidad — importar crea una copia real e independiente en la organización receptora, siempre como `draft`, nunca un link en vivo al original. Diálogo "Sharing" nuevo en el editor (`design-editor/page.js`), con lista de shares salientes (con revoke) y entrantes (con import).

### Fixed — encontrados en vivo, en navegador real, durante la verificación de esta misma ronda
- **Logout falso ante un 403 esperado**: `apiFetch` (`lib/api.js`) redirige a `/auth/login` ante cualquier 401/403 — correcto para una sesión inválida, pero `approveDesign`/`rejectDesign` devuelven 403 legítimamente cuando alguien intenta aprobar/rechazar su propia plantilla enviada a revisión (una regla de negocio, no una sesión inválida). Antes del fix, ese 403 esperado sacaba a la persona de su sesión en vez de mostrar el mensaje de error. Corregido pasando `redirectOnUnauthorized: false` en esas dos llamadas. Verificado en vivo con dos admins reales de la misma organización: el primer admin ve el error inline ("You cannot approve a template you submitted yourself...") sin perder la sesión; el segundo admin aprueba con éxito (`200`, plantilla publicada).
- **Colisión de campos "Custom" (texto estático)**: varios elementos de texto estático comparten literalmente el mismo `text_title: 'custom'` (así funcionaba desde antes de esta ronda). El filtro inicial del formulario de emisión individual mostraba un input separado por cada uno, todos escribiendo a la misma clave `custom_fields.custom` — editar uno sobrescribía silenciosamente a los demás. Corregido excluyendo también `text_title === 'custom'` del filtro (solo un campo verdaderamente dinámico, con clave propia, recibe un input a la hora de emitir).

### Known limitations
- **Las plantillas de la galería ("Start from a template") no se pueden emitir tal cual, sin re-subir el fondo** — límite preexistente, no introducido ni arreglado en esta ronda, y afecta igual a las 6 originales que a las 6 nuevas. El fondo de una plantilla de galería queda apuntando al propio frontend (`http://localhost:3000/templates/xxx.svg`); el microservicio de certificados solo puede alcanzar el host `storage` dentro de la red de docker (`TEMPLATE_ALLOWED_HOSTS=storage`), así que `generateCertificate` devuelve 502 ("Template host is not allowed") si no se reemplaza el fondo por una imagen subida de verdad antes de publicar. Confirmado en vivo, reproducido con una llamada directa al microservicio.
- La plantilla "Tech Gradient" armada durante esta verificación no incluía un elemento `recipient_name` — el nombre del destinatario no queda impreso en ningún lado de esa plantilla en particular. Es un detalle de esa plantilla puntual (se puede agregar el campo desde el editor), no un bug del sistema.
- El diálogo "Sharing" no ofrece un directorio de organizaciones para elegir a quién compartir — el admin tiene que conocer y tipear el `organization_code` exacto de la otra organización (compartido fuera del sistema). No hay una forma de "buscar organizaciones" expuesta a un admin normal, a propósito (evita que cualquier organización pueda enumerar a las demás).
- El CSV de emisión masiva no tiene columnas dedicadas a campos dinámicos todavía — el backend ya acepta `custom_fields` por destinatario (`recipient.custom_fields`, ver `queues/bulkIssuanceQueue.js`), pero la UI de carga masiva no construye ese objeto desde el CSV.

### Tests
- Backend: 30 tests nuevos, reales, contra MongoDB real (`mongodb-memory-server`) y — para los que necesitan render real — contra el microservicio de certificados real en la red de docker: `tests/customFields.unit.test.js` (10), `tests/customFieldsIssuance.integration.test.js` (4, incluyendo un render real con sustitución verificada por lectura directa de MongoDB), `tests/designApprovalWorkflow.integration.test.js` (13), `tests/designSharing.integration.test.js` (12, ajustado a 13 con el nuevo total). Total backend: 219 (antes 181), 215 pasan, 4 se saltan limpio (3 preexistentes + 1 que necesita el microservicio, corrido aparte contra él y confirmado pasando), 0 regresiones.
- Frontend: `npm run build` (producción, webpack) compila sin errores en las 19 rutas, incluyendo `/credentials`, `/credentials/design-editor` y `/settings`. 18/18 tests unitarios existentes, sin regresiones (ningún archivo tocado esta ronda tenía tests unitarios propios).
- Verificación manual real en navegador, contra el stack completo levantado con Docker Compose (no mocks): una organización nueva de prueba (creada vía `POST /api/organizations/self-signup`, plan Free), dos admins reales de esa organización (para probar aprobación cruzada) y una segunda organización de prueba real (para probar compartir entre organizaciones) — las tres provisionadas con datos propios de esta verificación, no se tocó ninguna organización/usuario preexistente. Flujo completo probado de punta a punta: Brand Kit guardado y reflejado en el editor → galería de 12 plantillas → campo dinámico creado y renombrado → aprobación bloqueada por auto-revisión y luego aprobada por un segundo admin real → autosave disparado solo (`PUT` real sin acción manual) → preview real (201, imagen real) → confirmar emisión (201, credencial real, `custom_fields` persistido y confirmado por lectura directa de MongoDB) → compartir con una segunda organización real → esa organización ve el share e importa una copia real e independiente como draft.

## Auditoría técnica y de seguridad integral (33 secciones) — 2 hallazgos reales corregidos con ejecución real, MongoDB con autenticación por primera vez

Auditoría completa del repositorio (no solo lo tocado en rondas recientes): inventario, arquitectura, superficie de API completa, matriz de autorización, revisión profunda de SAML/Entra ID contra el código fuente real de `samlify`, y pruebas activas de aislamiento multi-tenant con organizaciones ficticias nuevas. `AUDIT_FIXES.md` ya documentaba 32 rondas previas (incluyendo un framework de 33 secciones anterior con hallazgos `AUD-105`/`AUD-106`/`AUD-107`) — esta ronda no repite ese trabajo, lo verifica y busca lo que sobrevivió a esas 32 rondas.

### Security — CRITICAL, verificado con ejecución real
- **MongoDB corría sin autenticación.** Confirmado conectándose desde un contenedor sin relación en la misma red de Docker, con cero credenciales: acceso de lectura/escritura completo a las dos bases (`ebadgeid`, `ebadgeid_helpdesk`). Corregido habilitando `--auth --keyFile` en `docker-compose.yml`, con 3 usuarios de mínimo privilegio (`root` solo administración; `ebadgeid_app` y `ebadgeid_helpdesk_app`, cada uno con `readWrite` únicamente sobre su propia base). Migración ensayada primero en un contenedor aislado con volumen de prueba (incluyendo un error propio detectado y corregido durante el ensayo: recrear el contenedor con un volumen nuevo en vez de reutilizar el real habría perdido los usuarios creados) antes de aplicarse al stack real. Contraseñas generadas al azar, guardadas únicamente en un `.env` de raíz nuevo (gitignored, nunca en el zip de entrega) y referenciadas por variable en `docker-compose.yml` — nunca como texto plano en ningún archivo versionable. Procedimiento de arranque para despliegues nuevos documentado en `PRODUCTION_RUNBOOK.md`, sección 1.b.
- **Verificado real, antes y después**: el mismo intento de conexión sin credenciales que antes funcionaba ahora es rechazado (`Command ... requires authentication`); login real, lectura de datos reales, la organización real de la integración SAML de una ronda anterior, y el flujo SAML completo (`/metadata` 200, `/login` 302) siguen funcionando sin cambios después de la migración; un ciclo completo `docker compose down` / `up` (sin `-v`) confirma que los datos reales persisten con la nueva configuración de autenticación.

### Fixed — HIGH, fuga cross-tenant real encontrada y corregida con ejecución real
- **`GET /api/performance/:username`** (`routes/user_dash_algorithm.js`): una ronda anterior (`AUDIT_FIXES.md`, "Decimocuarta ronda") ya había corregido el hallazgo original acotando por `organization_code` la búsqueda del usuario — pero las 7 consultas de credenciales/puntajes que siguen en la misma función, después de esa corrección, seguían filtrando solo por `achiever_username`/`username`, sin `organization_code`. Inofensivo para un destinatario registrado real (username con índice único global, confirmado en `models/user_model.js`), pero no para una credencial de invitado, cuyo nombre es texto libre que solo se valida contra colisiones dentro de la propia organización emisora (`credentialController.createCredential`). Reproducido con ejecución real, no en teoría: se crearon dos organizaciones ficticias nuevas, la organización A con un usuario real, la organización B emitió una credencial de invitado con el mismo nombre — el panel de rendimiento de la organización A, para su propio usuario real, mostraba la credencial de la organización B (organización, código de credencial, nombre del destinatario invitado). Corregido escopando las 7 consultas de `Credentials` más el `aggregate` de `Score` por `organization_code`, mismo patrón ya usado en la búsqueda del usuario. Reverificado con la misma petición HTTP real: ahora devuelve 0 credenciales/logros, sin afectar el acceso normal de la organización B a su propia credencial.
- Test de integración nuevo y real (`tests/performanceDashboardTenantIsolation.integration.test.js`, 4 tests) que fija este escenario exacto contra MongoDB real, para que esta clase de fuga no pueda reaparecer en silencio.

### Changed — código muerto verificado, sin consumidores
- Eliminados `debug_saml.js`, `debug_saml2.js`, `debug_saml3.js` (0 bytes cada uno) y `middleware/organizationCheck.js` (dos funciones completas, `checkOrganizationAccess`/`checkContractOrganizationAccess`, sin ningún import en todo el repo — verificado con grep global antes de borrar).
- Eliminado el `requireAdmin` duplicado y sin uso de `middleware/authMiddleware.js` (una segunda implementación, distinta y más estricta que la de `middleware/requireAuth.js`, que es la que sí se usa en todo el sistema) — verificado que ningún archivo lo importaba antes de quitarlo.
- Corregido `backend (updated)/package.json`: `"main"` apuntaba a `index.js`, un archivo que no existe; corregido a `api.js`, el punto de entrada real (`npm start`).

### Known limitations — hallazgos abiertos, documentados con motivo, no corregidos esta ronda
- **SAML — sin protección real de replay (`InResponseTo`)**: confirmado leyendo el código fuente real de `samlify` (`node_modules/samlify/build/src/flow.js`, `validator.js`), no asumido — la librería extrae el campo `InResponseTo` de la respuesta pero nunca lo compara contra ningún `AuthnRequest` realmente emitido, y `services/samlAuth.js` tampoco guarda ese estado en ningún lado. Un `SAMLResponse` válido, correctamente firmado y dentro de su ventana `NotOnOrAfter`, podría reenviarse y aceptarse de nuevo como un login válido. Confirmado en el mismo repaso: la firma, el `Issuer` (contra el IdP específico de cada organización) y `NotBefore`/`NotOnOrAfter` sí se validan y sí se aplican de verdad. No corregido esta ronda a propósito — requeriría agregar seguimiento de estado del lado del SP (ej. Redis con TTL corto por `AuthnRequest` emitido) y no se quiso arriesgar el flujo SAML real ya validado por el usuario contra su propio tenant de Microsoft Entra ID sin una ronda dedicada con más margen de prueba.
- **Sin rate limit dedicado en las rutas SAML**: `/api/auth/saml/:organization_code/login` y `/acs` quedan cubiertas por el límite global (300 solicitudes/15 min por IP), pero no tienen un límite específico más estricto como sí lo tiene `/api/auth/login` (20/15 min). Cada intento contra el ACS dispara parseo XML y validación de esquema antes de fallar.
- **`test.js` y `generateStatements.js`** (raíz del backend): no se borraron. `test.js` es en realidad un script de seed mal nombrado (su propio encabezado dice `// seed.js`), sin ningún consumidor. `generateStatements.js` genera estados de cuenta bancarios falsos sin relación aparente con el dominio de eBadge ID, tampoco tiene consumidores. Ninguno de los dos forma parte de `npm test`/`npm start` ni de ningún flujo real de la aplicación — se dejan documentados en vez de borrados por incertidumbre genuina sobre su propósito, no por considerarlos seguros.
- El resto de la superficie de API revisada esta ronda (organizaciones, credenciales, notificaciones, assets, puntajes, contratos) se verificó correctamente protegida — no se encontraron más fugas cross-tenant nuevas más allá de la ya descrita.

### Tests
- Backend: 223 (antes 219), 219 pasan, 4 se saltan limpio (mismos de siempre, infraestructura externa fuera de la corrida estándar), 0 regresiones. Frontend: 18/18. `help_backend`: 20/21 (1 skip esperado, mismo de siempre).
- Verificación de infraestructura real: ensayo aislado de la migración de MongoDB antes de tocar el stack real; ataque sin credenciales reproducido antes del fix (exitoso) y después (rechazado); ciclo completo `docker compose down`/`up` con persistencia real confirmada; SAML (`/metadata`, `/login`) y login tradicional sin regresión tras la migración.

## Cierre de los 5 hallazgos pendientes de la auditoría — SAML con protección real de replay, incluida

Por instrucción explícita del usuario ("resuélveme esto de una vez por todas"), se cerraron los 5 puntos que la ronda anterior había dejado documentados pero sin corregir — incluido el de prioridad ALTA (SAML sin protección de replay), esta vez con margen real para probarlo con cuidado antes de aplicarlo.

### Security — HIGH, SAML ahora valida `InResponseTo` de verdad
- **Protección real de replay implementada**: `services/samlAuth.js` ahora registra cada `AuthnRequest` que emite `/login` como "pendiente y no consumido" en Redis (reutilizando `utils/cache.js`, la misma infraestructura ya usada para el caché de verificación pública), y `handleAssertion` (el manejador del ACS) exige que el `InResponseTo` de la respuesta coincida con un registro real, consumiéndolo al usarlo — la misma respuesta firmada nunca puede aceptarse dos veces. Confirmado con ejecución real, no en teoría: se armó una organización de prueba real con un IdP autofirmado real, se llamó a la lógica real de `/login` (que escribió el registro en el Redis real del stack), se construyó una respuesta firmada real con ese `InResponseTo`, se envió una vez al ACS real (aceptada, 302 a `sso=success`) y se reenvió exactamente igual una segunda vez (rechazada, 400 "already used, expired, or was not issued by this application").
- **Diseño explícito para no arriesgar el login real ya validado**: la protección solo se activa si `REDIS_URL` está configurado (mismo criterio "opt-in" que ya usan el caché y la cola de emisión masiva) — si Redis llegara a no estar disponible, el login SAML sigue funcionando exactamente como antes (la verificación criptográfica de la firma sigue siendo la barrera real), en vez de que una caída de Redis tumbe también el login. En este despliegue, Redis es una dependencia obligatoria y saludable de `api`, así que la protección está activa de verdad, no solo en teoría.
- Confirmado sin romper nada: la organización real de la integración con Microsoft Entra ID (`editor-test-org-784657`) sigue respondiendo `/metadata` (200) y `/login` (302) sin cambios después del despliegue.
- 3 tests de integración nuevos y reales (`tests/samlReplayProtection.integration.test.js`), usando el mismo mecanismo de inyección de un Redis de prueba que ya usaba `tests/cache.test.js`: un login real sigue funcionando con la protección activa, el mismo response reenviado se rechaza, un login genuinamente nuevo después de un replay rechazado sigue funcionando (la protección no bloquea a la organización, solo la respuesta reusada), y una respuesta con un `InResponseTo` que este SP nunca emitió se rechaza directamente.

### Security — LOW, rate limit dedicado en SAML
- `routes/samlRoutes.js`: nuevo límite específico (20 intentos/15 min, por IP + organización) en `/login` y `/acs`, mismo patrón que `authLimiter` ya usa para el login tradicional — antes solo dependían del límite global de toda la API (300/15 min por IP). Confirmado activo con ejecución real: los encabezados `RateLimit-Policy` de la respuesta muestran ambos límites (global y el nuevo, dedicado) aplicados a la misma ruta.

### Changed
- Borrados `test.js` (script de seed mal nombrado) y `generateStatements.js` (generador de estados de cuenta falsos sin relación con el dominio) — ambos sin ningún consumidor real, confirmado antes de borrar. Copia de respaldo guardada fuera del repositorio por las dudas.
- `docs/ARCHITECTURE.md` actualizado: de 6 componentes documentados a los 12 reales (agregados `redis`, `certificate`, `storage`, `mongo-init`, `migrate`/`help-migrate`), verificado contra `docker-compose.yml`. Diagrama actualizado para reflejar Redis y el microservicio de certificados.
- El repositorio ahora tiene control de versiones real (`git init` + 2 commits) — antes no existía ningún historial de cambios.

### Tests
- Backend: 226 (antes 223), 222 pasan, 4 se saltan limpio (mismos de siempre), 0 regresiones. Frontend: 18/18 sin cambios.
- Verificación end-to-end real contra el stack completo corriendo: login SAML real aceptado, replay del mismo response real rechazado, límite de tasa dedicado confirmado activo por los propios encabezados de la respuesta, organización real de Entra ID sin regresión.

### Known limitations — ya no quedan hallazgos abiertos de esta auditoría
- No queda ningún hallazgo de la tabla maestra de la auditoría sin cerrar. El próximo paso natural, fuera del alcance de esta ronda, es una revisión periódica (por ejemplo, cada vez que se agregue una integración externa nueva) en vez de una auditoría puntual única.
