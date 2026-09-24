# Despliegue de la consola de Super Admin

Estado al 1 de septiembre de 2026: **desplegada y sirviendo en el VPS**, a la
espera únicamente de que el DNS de `super.ebadgeid.com` resuelva.

## Dónde vive

| Elemento | Valor |
|---|---|
| Código | `/root/version_two/ebadgeid/frontend_super_admin` |
| Proceso pm2 | `ebadge-super` |
| Puerto interno | `8004`, enlazado a `127.0.0.1` (no expuesto directamente) |
| Sitio nginx | `/etc/nginx/sites-available/super.ebadgeid.com` |
| Dominio previsto | `super.ebadgeid.com` |

`version_two` es solamente el nombre histórico de la carpeta: es el árbol vivo
del que ya se sirve `app.ebadgeid.com`, no una versión antigua.

## Configuración

`/root/version_two/ebadgeid/frontend_super_admin/.env.local` (permisos 600):

```
PORT=8004
NEXT_PUBLIC_API_BASE_URL=https://api.ebadgeid.com/api
NEXT_PUBLIC_STORAGE_API_URL=https://storage.ebadgeid.com
```

Solo variables `NEXT_PUBLIC_*`: no hay secretos en este frontend.

## Lo único que falta

Apuntar `super.ebadgeid.com` a `82.112.238.229` (registro A). En cuanto
resuelva, emitir el certificado:

```
certbot --nginx -d super.ebadgeid.com
```

Certbot reescribe el sitio agregando el bloque 443 y la redirección 80→443,
igual que en los demás dominios de este servidor. El bloque HTTP ya está
escrito y validado, de modo que no hay nada más que preparar.

## Verificado sobre el servicio corriendo

- Escucha en el puerto 8004 y responde HTTP 200 en `/` y `/auth/login`.
- nginx enruta correctamente la cabecera `Host: super.ebadgeid.com` al 8004.
- Rutas retiradas (`/reports/financial`, `/reports/human_resources`,
  `/reports/sessions`) responden **404**: el andamiaje heredado ya no existe.
- Rutas vivas (`/reports/organizations`, `/super_admin`, `/user_dash`,
  `/settings`) responden **200**.
- Persistido con `pm2 save`; el servicio `pm2-root` está habilitado, así que
  sobrevive a un reinicio del servidor.
