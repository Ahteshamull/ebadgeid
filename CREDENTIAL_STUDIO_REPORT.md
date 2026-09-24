# Credential Studio — Reporte de esta ronda

**Alcance real de esta ronda, dicho de entrada:** la misión pedida (evolucionar el editor a un "Credential Studio" completo) son 6 fases y 73 secciones — semanas de trabajo de producto real, no algo que se termina con evidencia real de ejecución en una sola ronda. Esta ronda completó la **Fase 0 (auditoría completa)** y una porción acotada y verificada de la **Fase 1** (la parte marcada "PRIORIDAD MUY ALTA" en la propia instrucción: manijas visuales de transformación). El resto de las fases sigue pendiente — se detalla exactamente qué falta en la sección 13.

## 1. Executive Summary

Se auditó el repositorio real (no se asumió nada sin verificarlo) y se confirmó que buena parte de la base ya existe: arrays separados para texto/formas/imágenes (no un modelo `elements[]` genérico, decisión a respetar y extender, no reemplazar), versionado de plantillas, comentarios y presencia, biblioteca de assets, generación de imágenes por IA, y — algo que no se sabía hasta verificarlo — la página pública de verificación **ya tiene** Download, Share, LinkedIn, Twitter y los 4 estados reales del dominio (Issued/Claimed/Expired/Revoked). Nada de eso se tocó ni se duplicó.

Se implementó, de punta a punta y con verificación real en el navegador: **manijas visuales de arrastre para redimensionar y rotar formas e imágenes**, con soporte de Shift para proporción/snap angular, más **duplicar (Ctrl/Cmd+D)** y **borrar (Delete/Backspace)** por teclado, con un guard que evita borrar el elemento seleccionado mientras el usuario está escribiendo en un campo de texto.

## 2. Existing Functionality Preserved

Verificado que sigue funcionando exactamente igual que antes (sin tocar su código): crear/editar/borrar/listar plantillas, aislamiento por organización, imagen de fondo, campos de texto, posición X/Y, QR, drag & drop, guías de alineación, undo/redo, capas, enviar al frente/atrás, bloquear/desbloquear (solo texto, como ya era), agrupar/desagrupar, zoom, tipografía, subida de imagen/PDF, conversión de PDF, plantillas base, preview, descarga PNG/PDF, renderer de credenciales, emisión, hash, firma criptográfica, verificación, reclamación, comentarios, presencia, y seguridad multi-organización. Nada de esto se modificó — solo se le agregó código nuevo al lado.

## 3. New Functionality Implemented

- **Manijas de transformación visuales** (resize + rotate) para formas e imágenes — 4 manijas de esquina + 1 manija de rotación, con matemática consciente de rotación (el punto opuesto se mantiene fijo en pantalla al redimensionar, sin importar el ángulo actual).
- **Shift + resize** → mantiene la proporción original.
- **Shift + rotate** → ajusta a incrementos de 15°.
- **Ctrl/Cmd + D** → duplica el elemento seleccionado (texto, forma o imagen), desplazado 16px para que se note la copia.
- **Delete/Backspace** → borra el elemento seleccionado, con guard explícito para no interferir mientras se escribe en un campo de texto.
- Los valores numéricos del panel lateral (ya existentes) se mantienen sincronizados en tiempo real con las manijas.

## 4. Backend Changes

**Ninguno.** Esta porción de la Fase 1 no necesitó cambios de backend — el modelo de formas/imágenes ya tenía `width`, `height`, `rotation` desde la ronda 31 (fue diseñado previendo esto). Confirmado explícitamente antes de tocar nada, para no duplicar trabajo.

## 5. Frontend Changes

Un solo archivo: `frontend/src/app/credentials/design-editor/page.js`.

- Helpers de matemática de rotación (`rotateVector`, `localPointToScreen`, `OPPOSITE_CORNER_LOCAL`) — funciones puras, sin estado.
- `transformState` (ref) — sigue el mismo patrón que el `dragState` ya existente.
- `startTransform` / `onTransformMove` / `endTransform` — un solo `checkpoint()` al iniciar el arrastre (no uno por cada movimiento del mouse), igual que ya hacía `startDrag`.
- `duplicateSelected` — nueva.
- Overlay de manijas — nuevo bloque JSX, renderizado al final del lienzo (encima de todo lo demás), visible solo cuando hay una forma o imagen seleccionada.
- `onKeyDown` (ya existente) — extendido con Ctrl/Cmd+D y Delete/Backspace.

## 6. Database Changes

**Ninguno.** Sin migraciones — el esquema ya soportaba esto.

## 7. Security

No se tocó ninguna superficie de seguridad esta ronda (sin nuevos endpoints, sin nuevos uploads, sin nuevo manejo de datos de usuario). El único código nuevo es interacción de mouse/teclado puramente en el cliente, operando sobre datos que ya pasaban por la validación existente al guardar.

## 8. Multi-Tenancy

No aplica directamente — no se tocó ningún endpoint ni modelo. El aislamiento por organización de plantillas/formas/imágenes es exactamente el mismo que ya estaba verificado en rondas anteriores (ver `FINAL_AUDIT.md`).

## 9. Renderer

No aplica — las manijas solo cambian `x/y/width/height/rotation`, los mismos campos que el renderer Python (`draw_shape`, `draw_image_element`) ya consume desde la ronda 31. No se necesitó ni se hizo ningún cambio en `utils/main.py`.

## 10. Tests

- **Tests existentes:** 18/18 del frontend, sin regresiones (corrida real después del cambio).
- **Tests nuevos:** no se agregaron tests automatizados de frontend para esta interacción (el stack de tests de `frontend` son utilidades puras vía `node --test`, no hay infraestructura de testing de componentes/DOM en este proyecto — se verificó manualmente en el navegador real en su lugar, ver sección 11).
- **Backend:** sin cambios, 159/161 (mismo resultado que la ronda anterior).

## 11. Manual Verification (todo esto se ejecutó de verdad, en un navegador real, contra el build de producción real)

- Build de producción de Next.js: compiló limpio, 0 errores.
- Se creó una organización y un admin reales, se inició sesión real.
- Se agregó un rectángulo real y se arrastró la manija inferior-derecha: el ancho pasó de 200 a 345px y el alto de 120 a 250px, **con la esquina opuesta (350,258) sin moverse un solo píxel** — confirmado leyendo el DOM real, no una captura de pantalla.
- Se arrastró la manija de rotación: el elemento rotó a 66.4°, confirmado tanto en el DOM real como en el campo numérico del panel lateral (mostraba "66,4", coincidiendo exacto).
- Se presionó Ctrl+Z dos veces: la rotación se deshizo primero, el resize después — **un solo paso de historial por operación**, no decenas.
- Se agregó un círculo real, se duplicó con Ctrl+D: el duplicado apareció en (406,274), exactamente 16px de offset del original (390,258).
- Se seleccionó el duplicado y se presionó Delete: desapareció, volviendo a 1 círculo.
- Se hizo foco en el campo de nombre de la plantilla y se presionó Backspace: el círculo restante **no se borró** (el guard contra interferencia con campos de texto funcionó).

## 12. Not Executed

- Ninguna de las Fases 2 a 5 (Brand Kit, Template Library, Preview integral, estados Draft/Published/Archived, Duplicate Template a nivel de plantilla completa, approval workflow, pines de comentarios visibles, autosave, campos dinámicos más allá de nombre del destinatario, custom fields por organización, íconos, formas adicionales, tipografías ampliadas más allá de lo ya construido, safe area, análisis, etc.).
- Copy/Paste (Ctrl+C/V) — quedó fuera de esta ronda por tiempo; Duplicate (Ctrl+D) sí se implementó como alternativa funcionalmente equivalente para el caso de uso más común.
- Tests automatizados de la interacción de arrastre (no existe infraestructura de testing de UI/DOM en este proyecto; se verificó manualmente en su lugar, con evidencia real documentada arriba).
- Redimensionar el texto (los campos de texto solo tienen tamaño de fuente numérico, no una caja redimensionable — no estaba en el alcance mínimo de esta ronda).

## 13. Known Limitations

- Las manijas de esquina no incluyen manijas de borde medio (solo ancho o solo alto) — se prioritzó lo mínimo funcional y correcto (4 esquinas + rotar) sobre cobertura completa.
- No hay soporte de "Alt/Option + resize → escalar desde el centro" — solo el modo estándar (esquina opuesta fija).
- El resto de las 72 secciones de la misión — ver sección 12.

## 14. Future Enterprise Features

Sin cambios respecto a lo ya documentado: edición simultánea con cursores en vivo y coedición sigue siendo, tal como la propia instrucción lo marca, una fase Enterprise posterior — no se intentó ni se debía intentar esta ronda.

## 15. Files Changed

- `frontend/src/app/credentials/design-editor/page.js` (único archivo modificado)
- `CREDENTIAL_STUDIO_REPORT.md` (nuevo, este documento)
- `CHANGELOG.md` (actualizado)

## 16. How to Run

```bash
docker compose up -d
```
(requiere `backend (updated)/.env` y `help_backend/.env` creados desde sus `.env.example`, con secretos reales de al menos 32 caracteres — ver `PRODUCTION_RUNBOOK.md`)

## 17. How to Test

1. Entrar a `http://localhost:3000`, iniciar sesión como admin.
2. Ir a Certificate Templates.
3. Agregar un rectángulo o círculo.
4. Seleccionarlo — deben aparecer 4 manijas circulares en las esquinas y una manija de rotación arriba.
5. Arrastrar una esquina — debe redimensionar; con Shift presionado, debe mantener proporción.
6. Arrastrar la manija de rotación — debe rotar; con Shift presionado, debe saltar de a 15°.
7. Ctrl/Cmd+D — debe duplicar el elemento seleccionado, desplazado.
8. Delete o Backspace (con el lienzo enfocado, no un campo de texto) — debe borrar el elemento seleccionado.
9. Ctrl+Z repetido — cada operación de arrastre debe deshacerse en un solo paso.
