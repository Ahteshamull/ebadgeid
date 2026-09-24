# Integraciones externas

## Estado honesto (actualizado tras la auditoría técnica integral end-to-end)

**Ya implementadas, corriendo en el stack real, y validadas — no pendientes:**

- **Redis** — corre como servicio propio en `docker-compose.yml` (`redis:7`), sin infraestructura externa que provisionar. Usado para rate limiting distribuido, presencia del editor de diseños, cache, y la cola BullMQ de emisión masiva.
- **SSO/SAML 2.0** — implementado (`services/samlAuth.js`, vía `samlify`), con protección real de replay (InResponseTo validado contra Redis) y rate limiting dedicado. Validado por el propietario del proyecto contra un tenant real de Microsoft Entra ID.
- **Correo (envío real)** — un único sistema, Nodemailer/SMTP sobre la misma casilla real (`EMAIL_USER`/`EMAIL_HOST`, ver `utils/smtpTransporter.js`), usado tanto para invitaciones/bienvenida (`utils/mailer.js`) como para credenciales/contratos (`services/emailService.js`). Reemplazó a Resend en esta ronda de trabajo, por instrucción explícita del propietario — ya no hay ninguna API de correo de terceros en el proyecto. Todo el HTML generado a partir de datos controlados por el usuario se escapa correctamente.
- **IA (chatbot de soporte)** — cadena real de fallback entre 4 proveedores (Gemini → DeepSeek → OpenRouter → OpenAI) en `help_backend/services/aiGateway.js`, degrada a un mensaje genérico si ninguno está configurado, nunca falla de forma visible al usuario.
- **Generación de imágenes con IA** — integración real y sin clave con Pollinations.ai (`controllers/uploadController.js`).
- **Pagos (Tilopay)** — integración real de pago único para el alta de organizaciones (`services/selfServiceSignup.js`, `services/tilopayClient.js`), construida contra la colección Postman real de Tilopay (https://documenter.getpostman.com/view/12758640/TVKA5KUT). Login (obtención de token) verificado con ejecución real contra las credenciales reales del propietario. **Limitación real, no de este código**: a diferencia de Stripe, Tilopay no publica una fórmula de firma/HMAC verificable para su redirect de confirmación de pago (su propia documentación indica escribir a soporte para obtenerla) — la mitigación aplicada es una referencia de orden (`orderNumber`) no adivinable, no una verificación criptográfica. Ver el comentario de cabecera de `services/tilopayClient.js` para el detalle completo. Reemplazó a Stripe en esta ronda de trabajo, por instrucción explícita del propietario.

**Requieren credenciales/cuenta real del propietario para operar en producción (código completo, no verificable end-to-end sin ellas):**

| Integración | Información requerida | Prueba de aceptación |
|---|---|---|
| Tilopay | credenciales reales (ya provistas y verificadas con un login real) para producción; ideal obtener además credenciales de sandbox para seguir probando sin mover dinero real | login real ya confirmado; falta la fórmula real de verificación de OrderHash (pedir a soporte de Tilopay) antes de procesar dinero real de un cliente final |
| IA (chatbot) | al menos una API key real entre Gemini/DeepSeek/OpenRouter/OpenAI | respuesta real del proveedor, fallback entre proveedores |
| LMS | sandbox real, OAuth, scopes y documentación del LMS específico | alta, sincronización, errores, límites y reintentos — la integración ya está probada contra un servidor HTTP simulado local |

**Genuinamente pendiente de infraestructura (no es un problema de credenciales):**

- **Cron/scheduler real** para los jobs diarios (notificación de vencimiento de credenciales, anclaje blockchain diario) — ver `scripts/cronRunner.js` y el servicio `cron` en `docker-compose.yml`, agregados en la ronda de auditoría técnica integral para cerrar exactamente este pendiente.
- **Blockchain MAINNET con fondos reales** — el código de anclaje está implementado y probado contra una red de prueba; nunca fue validado contra una red real con fondos, por decisión explícita de alcance.

## Uso real en producción (medido, no estimado — 2026-08-31)

Consultado directamente contra la base de producción para saber cuáles de estas
integraciones están en la ruta crítica del lanzamiento y cuáles no. Los números
son conteos reales, no supuestos:

| Integración | Evidencia en producción | Consecuencia |
|---|---|---|
| SSO/SAML 2.0 | `organizationsamlconfigs`: **0 documentos** — ninguna organización lo tiene configurado | No está en la ruta crítica. Ningún inicio de sesión actual depende de SAML. |
| Pagos (Tilopay) | `transactions`: **0** · `paymentproofs`: **0** · `pendingorgsignups`: **0** | Nunca se ha cobrado por este medio en producción. No está en la ruta crítica. |

Esto **no** dice que el código esté sin probar: según lo registrado más arriba, el
propietario validó SAML contra un tenant real de Entra ID y el login de Tilopay
contra credenciales reales. Lo que dice es más simple y más útil para decidir:
hoy nadie los usa, así que ninguno de los dos bloquea la salida a producción del
resto del sistema.

**La condición que sí sigue vigente antes de cobrar dinero real** es la ya
descrita para Tilopay: falta la fórmula real de verificación del OrderHash, que
solo Tilopay puede entregar. Mientras no exista, la confirmación del pago se
apoya en una referencia de orden no adivinable y no en una verificación
criptográfica. Esa es una limitación del proveedor, no de este código, y es la
única de las dos que tiene consecuencias de seguridad.

## Andamiaje retirado

El frontend de Super Admin arrastraba páginas y componentes heredados de otro
producto (`eduhubsync`: campus, syllabus, reportes de RRHH y de sesiones) que
consultaban `api.eduhubsync.com` y `ftp.eduhubsync.com`, dominios que ya no
resuelven. Nada del producto los enlazaba, salvo un detalle que sí importaba: el
`default:` del redirector de login apuntaba a una de esas páginas, de modo que
cualquier rol no contemplado por el `switch` aterrizaba en una pantalla
permanentemente rota. Se retiraron las tres rutas y los tres componentes, y el
`default:` pasó a la página real de menor privilegio. Quedan 0 referencias a esos
dominios en todo el repositorio.

## Regla de implementación

Todas las integraciones deben quedar detrás de adaptadores, con timeout, reintentos acotados, idempotencia, circuit breaker cuando aplique, métricas y mensajes que no filtren credenciales.
