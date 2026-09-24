# Notas de entrega

## Alcance

Entrega consolidada de código fuente, seguridad de sesión, autorización multiempresa, contratos, helpdesk, editor visual, pruebas y documentación operativa.

## Validación incluida

- 14 pruebas del backend principal.
- 4 pruebas de autorización y OTP del helpdesk.
- 3 pruebas del frontend principal.
- 3 pruebas del frontend helpdesk.
- 3 pruebas del módulo contractual.
- Comprobación sintáctica recursiva de los dos backends.
- Escaneo de patrones de secretos antes del empaquetado.

## Release gate conocido

Los manifests declaran líneas parcheadas de Next.js, pero el entorno de auditoría bloqueó el registro npm con `EACCES`. En un CI con red normal se debe ejecutar una instalación sin lock congelado una vez, revisar y confirmar los lockfiles resultantes y después ejecutar `scripts/verify.ps1` o `scripts/verify.sh`. No desplegar hasta completar ese gate.

## Fuera del ZIP

No se incluyen secretos, archivos `.env`, bases de datos, cargas privadas, `node_modules`, cachés de pnpm, artefactos `.next` ni historial Git.
