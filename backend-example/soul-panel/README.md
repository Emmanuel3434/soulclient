# Soul Panel — Panel web de administración

Panel web (PHP + Supabase) para gestionar el ecosistema SoulClient desde el
navegador, sin tocar el launcher. Corre sobre cualquier hosting PHP
(apache/nginx + PHP 8, con `curl` y `json` habilitados).

## Archivos

| Archivo | Función |
|---|---|
| `index.html` | Interfaz: instancias, mods, config_files, códigos, noticias + publicar ZIP |
| `api.php` | Proxy hacia Supabase (REST + Storage). Guarda la service key en el servidor |
| `config.php` | Credenciales de Supabase (URL, service key, bucket). **No se expone nunca** |
| `add_java_version.sql` | Columna `java_version` en `instances` (opcional, si falta) |

## Configuración

1. Sube los 3 archivos (`index.html`, `api.php`, `config.php`) a tu hosting.
   **Importante:** `config.php` DEBE ser la versión de Supabase (define
   `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `SUPABASE_BUCKET`). No uses la
   antigua de MySQL.
2. Ajusta los valores de `config.php` si cambias de proyecto Supabase.
3. Asegúrate de que el bucket `instances` exista y sea **público**
   (Dashboard → Storage → instances → Settings → Public).
4. Si la tabla `instances` no tiene `java_version`, ejecuta
   `add_java_version.sql` en el SQL Editor.

La tabla `instances` también necesita las columnas nuevas del flujo de
publicación (`sha256`, `size_bytes`, `published_at`, `updated_at`,
`downloads`, `allowed_discord_ids`). Están incluidas en
`../../supabase_schema.sql` (bloque `do $$`).

## Publicar el ZIP de una instancia desde el panel

1. Entra a **Instancias** y haz clic en una instancia.
2. En **Publicar ZIP**, selecciona el `.zip` del modpack y pulsa
   **Subir y publicar**.
3. El navegador:
   - Pide a `api.php` (`sign_upload`) una **URL firmada** de Supabase Storage
     (la service key nunca sale del servidor).
   - Calcula el SHA-256 del archivo con `crypto.subtle`.
   - Sube el ZIP directamente a esa URL (`PUT`, `x-upsert: true`).
   - Llama a `api.php` (`finalize_publish`) para guardar `sha256`,
     `size_bytes` y la fecha de publicación en la fila de la instancia.

El launcher descarga el ZIP desde el worker
(`GET /instances/:id/download`) y **verifica que su SHA-256 coincida** con el
guardado; si no, rechaza la instalación.

## Endpoints extra en `api.php`

- `GET api.php?action=sign_upload&id=<uuid>` → `{ "signedUrl": "https://…" }`
- `POST api.php?action=finalize_publish&id=<uuid>` con body
  `{ "sha256": "…", "size_bytes": 123 }` → actualiza la fila
- `GET api.php?action=catalog` → catálogo en formato camelCase (el del launcher)
- `GET api.php?action=download&id=<uuid>` → 302 al ZIP público en Storage

## Rutas del launcher (Apache: subí también `.htaccess`)

El launcher consulta `{tudominio}/instances` y `{tudominio}/instances/{id}/download`
(donde `{tudominio}` es el **origen** de la URL que configures en Ajustes →
URL de backend). El `.htaccess` incluido mapea esas rutas a `api.php`:

```
/instances               -> api.php?action=catalog
/instances/{id}/download -> api.php?action=download&id={id}
```

Subí `api.php`, `index.html`, `config.php` y `.htaccess` a la **raíz** de tu
hosting (public_html). En NGINX usá un bloque equivalente:

```nginx
location /instances { rewrite ^/instances$ /api.php?action=catalog last; }
location ~ ^/instances/([^/]+)/download$ { rewrite ^/instances/([^/]+)/download$ /api.php?action=download&id=$1 last; }
```
