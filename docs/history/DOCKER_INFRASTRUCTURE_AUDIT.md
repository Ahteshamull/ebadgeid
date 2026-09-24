# DOCKER / INFRASTRUCTURE AUDIT — eBadge ID

## Disponibilidad de Docker en este entorno — **NOT VERIFIED, explícito**

`docker`/`docker compose` no están disponibles en el entorno donde se ejecutó esta auditoría (`docker: not found`). Por lo tanto: **`docker build`, `docker compose build`, `docker compose up` y `docker compose ps` NO se pudieron ejecutar realmente**, tal como pide el framework de auditoría en la Fase 11. Lo que sí se hizo, como evidencia parcial honesta (no equivalente a un build real):

1. Validación de sintaxis YAML de `docker-compose.yml` — **VERIFIED**, parsea correctamente con `python3 -c "import yaml; yaml.safe_load(...)"`.
2. Verificación de que cada comando que los 5 Dockerfiles ejecutan (`npm install`/`npm ci`, `npm run build`) funciona de forma aislada, fuera de un contenedor — **VERIFIED** (ver `AUDIT_REPORT` / evidencia de tests y builds en `FINAL_AUDIT_SUMMARY.md`).
3. Verificación de que los puertos internos declarados en cada Dockerfile coinciden con los que cada servicio realmente usa — **VERIFIED** (detalle abajo).

**Ninguna de estas tres verificaciones reemplaza un build de imagen real.** Un problema de la capa Docker en sí (orden de capas, cache de build, tamaño de imagen, compatibilidad de la imagen base `node:22-alpine` con las dependencias nativas que algunos paquetes puedan requerir) permanece como riesgo no cuantificado.

## Hallazgos reales, confirmados sin necesidad de ejecutar Docker

### 1. `docker-compose.yml` depende de archivos `.env` que no existen en el repo — **P1, corregido (documentación)**

```yaml
env_file: "./backend (updated)/.env"
env_file: ./help_backend/.env
```

Estos archivos **no existen** en el zip entregado — a propósito, para no versionar secretos (solo se incluyen `.env.example`). Antes de esta auditoría, **no había ninguna mención a Docker en ningún archivo de documentación** (`README.md`, `docs/*.md`) — cero instrucciones sobre este prerequisito. Cualquiera que clonara el repo y corriera `docker compose up` directamente habría fallado de inmediato, sin ninguna pista de por qué.

**Corregido**: se agregó una sección "Docker / docker-compose" a `README.md` con el paso explícito (`cp .env.example .env` en cada backend) antes de levantar el compose.

### 2. Servicio de storage inexistente referenciado por puerto — **P2, documentado, no resuelto**

```yaml
helpdesk:
  build:
    args:
      NEXT_PUBLIC_UPLOAD_BASE_URL: http://localhost:9000
contracts:
  build:
    args:
      NEXT_PUBLIC_UPLOAD_BASE_URL: http://localhost:9000
```

No existe ningún servicio definido en `docker-compose.yml` escuchando en el puerto `9000`. Investigando el código real (`helpdesk_frontend/src/lib/config.js`, `contract/src/lib/config.js`), esta variable por defecto apunta a `https://ftp.ebadgeid.com` — un servicio de storage/FTP de producción que existe **fuera de este repositorio** y no tiene equivalente self-hosted en el `docker-compose.yml` entregado. Esto es distinto del endpoint `/api/uploads` construido en `backend (updated)` (puerto 5000) para el editor de plantillas — son dos mecanismos de subida de archivos separados, uno documentado y con servicio real (`/api/uploads`), y otro (`ftp.ebadgeid.com`) que es una dependencia externa no incluida.

**No resuelto** — documentado explícitamente en `README.md` como gap conocido, ya que no hay evidencia suficiente en este repositorio para saber si ese servicio de FTP debe agregarse al compose (y con qué imagen) o si es intencionalmente externo y el build arg debería apuntar directamente a la URL de producción real incluso en desarrollo local.

### 3. Coherencia de puertos internos — **VERIFIED**

| Servicio | Puerto interno (`.env.example`) | `EXPOSE` en Dockerfile | Puerto publicado en compose |
|---|---|---|---|
| `backend (updated)` | 5000 | 5000 | 5000:5000 |
| `help_backend` | 8000 | 8000 | 8000:8000 |
| `frontend` | 3000 (Next.js default) | 3000 | 3000:3000 |

Sin discrepancias encontradas entre lo que cada aplicación espera y lo que Docker publica.

### 4. Lockfiles conflictivos (npm vs pnpm) — **P2, corregido**

`backend (updated)`, `help_backend` y `frontend` tenían simultáneamente `package-lock.json` (usado de verdad por los 5 Dockerfiles, todos con `RUN npm install`/`npm ci`) y `pnpm-lock.yaml`/`pnpm-workspace.yaml` — desactualizados hasta 4 días respecto al lockfile real, sin las dependencias agregadas después (`multer`, `pdf-to-img`, `file-type`). Si alguien hubiera modificado un Dockerfile para usar `pnpm install` (razonable dado que los archivos de pnpm estaban presentes, sugiriendo que era la herramienta soportada), el build habría producido un entorno roto e incompleto. **Eliminados los 7 archivos pnpm huérfanos** en los 5 servicios.

### 5. Imagen base y usuario — **VERIFIED (código)**

Los 5 Dockerfiles usan `node:22-alpine` (imagen oficial, delgada) y terminan con `USER node` antes del `CMD` — el proceso no corre como root dentro del contenedor. Buena práctica confirmada, sin hallazgos.

### 6. Healthchecks — **PARCIAL**

`docker-compose.yml` define un healthcheck real para el servicio `mongo`. Los servicios de aplicación (`api`, `help-api`, `app`, `helpdesk`, `contracts`) **no tienen healthcheck propio definido en el compose** — dependen de `depends_on` sin condición de salud, solo orden de arranque. Dado que `backend (updated)` y `help_backend` sí exponen un endpoint `/health` real y funcional (verificado en rondas anteriores de esta auditoría, incluyendo que reporta honestamente `"degraded"` cuando la base de datos no está conectada), sería una mejora de bajo costo agregar `healthcheck` a esos dos servicios en el compose usando ese endpoint ya existente — no requiere código nuevo, solo configuración.

## Resumen de severidad

| ID | Severidad | Estado |
|---|---|---|
| Docker sin documentar / `.env` faltante | P1 | **Corregido** (documentación) |
| Servicio de storage puerto 9000 inexistente | P2 | Documentado, sin resolver — requiere decisión de negocio (agregar servicio vs. usar URL de producción) |
| Lockfiles pnpm conflictivos | P2 | **Corregido** (eliminados) |
| Sin healthcheck en servicios de aplicación | P3 | Documentado, mejora recomendada, no bloqueante |
| `docker compose up` nunca verificado en ejecución real | — | **NOT VERIFIED**, limitación del entorno de esta auditoría, no del código |
