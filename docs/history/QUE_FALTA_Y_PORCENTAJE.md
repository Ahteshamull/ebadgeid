# QUÉ LE FALTA A ESTE PROYECTO Y EN QUÉ PORCENTAJE ESTÁ

*Resumen ejecutivo al cierre de la última ronda de auditoría. Ver `FINAL_AUDIT_SUMMARY.md` para el desglose completo por dimensión y `AUDIT_FIXES.md` para el historial línea por línea de todas las rondas.*

---

## Qué le falta — específico, no genérico

### Lo que bloquea llegar a "aprobado sin condicionar"

1. **Nunca se verificó contra Docker real ni MongoDB con datos reales.** Todo lo probado en esta auditoría se corrió contra `mongodb://localhost:27017` inexistente — confirma que el código falla de forma segura (401/403/500 controlado, nunca deja pasar algo que no debería), pero no confirma comportamiento con datos reales, volumen real, ni `docker compose up` corriendo de verdad. El entorno donde se hizo esta auditoría no tiene Docker instalado, así que esa pieza queda como **NOT VERIFIED**, no como "aprobada".

2. **Gap de storage sin resolver** (documentado, no inventado): `docker-compose.yml` apunta a un puerto 9000 para el que no hay ningún servicio definido — es una referencia a `ftp.ebadgeid.com`, un servicio de producción externo a este repositorio. Necesita una decisión de negocio: ¿se agrega ese servicio al compose, o se apunta directo a la URL de producción real incluso en desarrollo local?

3. **3 servicios de IA sin decisión** (`deepSeekService.js`, `openaiService.js`, `openRouterService.js`): están escritos, sin un solo consumidor real en todo el código. O se conectan como fallback de verdad si Gemini (el único proveedor realmente en uso) falla, o se eliminan — hoy no hacen nada, solo ocupan espacio y dan una falsa impresión de resiliencia multi-proveedor.

4. **Sin CI/CD.** Cero archivos de pipeline (`.github/workflows` o equivalente) en todo el repositorio. Es lo más barato de resolver y lo que hubiera atrapado automáticamente varios de los bugs encontrados manualmente en esta auditoría (lockfiles `pnpm` rotos, dependencias sin usar con vulnerabilidades).

### Lo que sigue siendo deuda conocida, no nueva de esta ronda

- ~~`localStorage` sigue siendo la vía primaria de sesión~~ — **corregido en esta ronda tras re-verificar**: los 3 clientes de API (`frontend`, `helpdesk_frontend`, `contract`) usan `credentials: 'include'` (cookie httpOnly), ninguno lee el token desde `localStorage`. Cada uso restante se confirmó no relacionado a sesión (idioma, un lock de UI, caché temporal de un PDF antes de subirlo). Este ítem estaba desactualizado en versiones anteriores de este documento.
- Sin caché (Redis) delante del endpoint de verificación pública de credenciales — el de mayor tráfico externo no controlado esperado.
- Sin cola de trabajo real para emisión masiva de credenciales (hoy es concurrencia de 5 en el navegador del cliente, no un broker).
- Rate limiting en memoria de un solo proceso Node — se resetea en cada reinicio, no se comparte si se escala a más de una instancia.
- Sin capa de Services/Repositories — los controladores hablan directo con Mongoose.
- Naming inconsistente `org_code` (JWT/params) vs `organization_code` (DB) — dejado a propósito por precaución histórica, ya no relacionado a `localStorage` dado que esa migración está completa.

---

## Porcentaje actual: **82/100**

Subió de 74% a inicio de la última sesión de auditoría. La razón del salto no fue agregar funcionalidad nueva — fue cerrar **8 hallazgos reales, verificados con ejecución real**, en una sola ronda:

- **2 vulnerabilidades críticas de seguridad**: ejecución arbitraria de JavaScript (RCE) en `pdfjs-dist` al procesar un PDF malicioso subido por un usuario (corregida y re-verificada subiendo un PDF real contra el servidor arrancado), y una dependencia typo-squat (`sooner`, instalada por error en vez de `sonner`) que traía 15-16 vulnerabilidades críticas por servicio.
- **1 bug que hubiera tumbado el arranque completo del servidor** si alguien lo tocaba sin darse cuenta: un controlador (`sseController.js`) con un `require()` apuntando a un archivo (`sseManager.js`) que directamente no existe en el repositorio.
- **5 hallazgos de código muerto, duplicado, o datos inventados** que venían arrastrándose de rondas anteriores sin detectar — incluyendo una segunda implementación completa y duplicada del widget de chat en vivo, y un endpoint que seguía devolviendo métricas de agentes de soporte inventadas (`currentChats: 0` fijo) pese a que el mismo problema ya se había corregido en otro archivo.

Todo esto se verificó con evidencia de ejecución real al cierre: **0 vulnerabilidades de dependencias, 37/37 tests reales pasando, 3/3 builds de producción con código de salida 0** — en los 5 servicios, desde una instalación limpia del zip final.

Lo que separa el 82% actual de un 95%+ real no es más código — es exactamente lo del punto 1 de arriba: verificar contra infraestructura real (Docker, MongoDB con datos, un proveedor de IA con cuota real) en vez de simulada. Eso es lo único que un entorno sin esos recursos no permite cerrar por sí mismo, sin importar cuántas rondas más de auditoría de código se hagan.
