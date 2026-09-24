# Integración segura de correcciones de autenticación — 28 de agosto de 2026

## Fuentes comparadas

- `eBadgeID_Codigo_Completo.zip`: base funcional y más reciente de eBadgeID.
- `eBadgeID_Correcciones_Hoy_2026-08-28.zip`: tres archivos de una aplicación anterior, centrados en recuperación por OTP y respuesta de login.

## Decisión de integración

Se integró la mejora compatible de la segunda fuente: `POST /api/auth/forgot-password` acepta de forma segura `username`, `usernameOrEmail` o `email`, y resuelve un correo de perfil al nombre de usuario canónico sin revelar si la cuenta existe.

Se añadió una prueba de integración que cubre el campo legado `usernameOrEmail` con el correo institucional.

## Cambios que deliberadamente no se copiaron

Los otros archivos del ZIP de correcciones no son una actualización lineal de esta base. Reemplazarlos habría eliminado o debilitado medidas presentes en el código completo:

- Cambiaban la recuperación por enlace con token hasheado, de un solo uso y con expiración, por OTP almacenado solo en memoria. Eso no sobrevive reinicios ni escala a varios procesos.
- Eliminaban las rutas de activación y reenvío, la protección CSRF y el limitador distribuido de consulta de usuario.
- Devolvían el JWT al JavaScript del navegador y promovían el uso de `localStorage`, mientras la base actual usa sesión de cookie `httpOnly` y CSRF.
- Quitaban validación de tipo para credenciales de inicio de sesión y comprobaciones de organización eliminada.

Por lo tanto, la versión combinada conserva la arquitectura más segura de la base completa y aporta la compatibilidad real de entrada necesaria para la pantalla anterior de recuperación.
