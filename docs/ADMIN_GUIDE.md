# Guía de administración

## Organizaciones y usuarios

- Cree usuarios mediante invitaciones; no comparta contraseñas iniciales.
- Asigne el menor rol necesario y revise accesos periódicamente.
- Mantenga un administrador de respaldo, pero evite cuentas administrativas compartidas.
- Desactive usuarios que salen de la organización y revoque claves API no utilizadas.

## Diseños

1. Abra el editor y seleccione una plantilla o cree una nueva.
2. Cargue una imagen de fondo de hasta 5 MB.
3. Añada campos de texto y el QR; use guías y cuadrícula.
4. Use Shift para selección múltiple, agrupe elementos relacionados y bloquee los terminados.
5. Revise a distintos niveles de zoom, guarde y emita una credencial de prueba.

## Claves API

- Genere claves exclusivamente para servicios de confianza.
- Guárdelas una sola vez en un gestor de secretos.
- Configure límites por minuto y expiración.
- Revoque inmediatamente claves sospechosas; nunca las incruste en JavaScript de frontend.

## Contratos

- Valide participantes y permisos antes de enviar invitaciones.
- Regenere invitaciones expiradas en lugar de extender secretos indefinidamente.
- Conserve trazabilidad de discusiones, firmas y cambios de estado.

## Helpdesk

- Los agentes solo deben acceder a tickets asignados o autorizados.
- Cambie estados siguiendo el flujo `open → in_progress/pending → resolved → closed`.
- Evite incluir datos sensibles en artículos, FAQs, mensajes o respuestas del chatbot.
- Escale incidentes de seguridad fuera del ticket ordinario.
