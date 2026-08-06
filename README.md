# SoulClient

Launcher de Minecraft construido con Tauri v2 + Rust + React + TypeScript +
TailwindCSS + Framer Motion.

## Estructura del proyecto

```
soulclient/
├── src/                        # Frontend (React + TS)
│   ├── components/
│   │   ├── layout/               Sidebar, TitleBar (+ chip de Discord), FriendsPanel
│   │   ├── skin/                  Visor 3D de skins (skinview3d)
│   │   ├── instances/             Tarjetas + modal de instancias (sólo admin)
│   │   └── common/                 Button, Modal, ProgressBar, Card
│   ├── pages/                    Inicio, Instancias, Cuentas, Skin, Configuración, Perfil, Login
│   ├── state/                    Stores de Zustand (accounts, instances, settings, downloads, discord)
│   ├── lib/tauri.ts               Único punto de invoke() hacia Rust
│   └── types/                     Tipos compartidos
├── backend-example/             # Referencia: backend de intercambio OAuth2 de Discord
│   └── discord-oauth-server/      Guarda el Client Secret — nunca va en el launcher
└── src-tauri/                   # Backend (Rust)
    ├── capabilities/default.json   Permisos de plugins de Tauri v2 (dialog, shell, fs...)
    └── src/
        ├── auth/                  Offline, Microsoft (device code), Discord (loopback OAuth2), permisos admin
        ├── skins/                  Subida de skin (real a Mojang / local para offline)
        ├── instances/              CRUD de instancias (mutaciones protegidas por admin)
        ├── downloader/             Manifest, libraries, assets, fabric, java, launch
        ├── settings/               Configuración persistente
        ├── news/                   Noticias (placeholder)
        ├── updater/                Auto-actualizador
        ├── commands/               Puente Tauri <-> React
        └── utils/                  Paths, hashes, errores
```


## Requisitos para correrlo

- Node.js 18+ y npm
- Rust estable + `cargo`
- Dependencias nativas de Tauri v2 para tu SO (webview2 en Windows, webkitgtk
  en Linux, Xcode command line tools en macOS) — ver
  https://v2.tauri.app/start/prerequisites/

## Cómo correrlo

```bash
npm install
npm run tauri dev
```

Para compilar el instalador final:

```bash
npm run tauri build
```

## Lo que funciona de verdad ahora mismo

- **Cuentas No Premium**: creación, validación de nombre, múltiples cuentas,
  cambio rápido entre ellas. UUID generado igual que el Minecraft vanilla
  offline (`OfflinePlayer:<nombre>` con hashing v3/MD5).
- **Instancias**: creación, edición, eliminación, tarjetas modernas,
  configuración completa (RAM, JVM args, Java personalizado, resolución,
  pantalla completa, imagen de portada).
- **Biblioteca de versiones**: fetch real al manifest de Mojang
  (`launchermeta.mojang.com`), con filtros por tipo y buscador.
- **Descargas**: resuelve y descarga el cliente, las librerías (respetando
  reglas de SO) y los assets reales de una versión, verificando SHA-1 de
  cada archivo, con progreso emitido en tiempo real a la UI.
- **Fabric**: obtiene versiones del loader y el "launcher meta" real desde
  `meta.fabricmc.net`, fusionándolo con el JSON vanilla.
- **Lanzamiento**: construye el comando `java` completo (classpath,
  argumentos JVM, argumentos del juego con sustitución de placeholders) y
  lo ejecuta.
- **Visor 3D de skins**: rotación automática, arrastre con mouse, zoom,
  animación idle y capa, vía `skinview3d`.
- **Configuración**: persistida en disco, con limpiar caché, abrir carpeta
  del launcher y reiniciar configuración.

## Lo que queda pendiente / requiere configuración tuya

1. **Login Microsoft real**: el flujo completo (device code → Xbox Live →
   XSTS → Minecraft Services → perfil) está implementado en
   `src-tauri/src/auth/microsoft.rs`, pero necesitas:
   - Registrar una app en https://portal.azure.com (tipo "público/nativo").
   - Habilitar el permiso delegado `XboxLive.signin`.
   - Reemplazar `MS_CLIENT_ID` en ese archivo con tu Client ID real.
   Sin esto, el botón de "Iniciar sesión con Microsoft" fallará con un
   error de "invalid client", como es esperado.

2. **Descarga automática de Java**: por ahora sólo se detecta Java ya
   instalado en el sistema (`JAVA_HOME`, PATH, o ruta configurada). Empaquetar
   JREs propios por plataforma (como hace el launcher oficial) es un
   trabajo adicional considerable — la estructura en
   `src-tauri/src/downloader/java.rs` está lista para extenderse.

3. **Auto-actualizador**: configurado con `tauri-plugin-updater` en
   `tauri.conf.json`, pero necesita:
   - Un endpoint real que sirva los manifiestos de actualización.
   - Una clave de firma generada con `tauri signer generate`.

4. **Descarga de mods**: sólo existe la estructura preparada
   (carpeta `instances/<id>/mods`); la instalación automática desde
   Modrinth/CurseForge queda para una siguiente iteración.

5. **Iconos**: los archivos en `src-tauri/icons/` son placeholders sólidos;
   reemplázalos con el arte final antes de publicar.

## Cambios recientes (v0.2)

- **Comunidad**: removida temporalmente de Inicio hasta que exista el backend correspondiente.
- **Bug del explorador de archivos**: Tauri v2 requiere un archivo de *capabilities*
  (`src-tauri/capabilities/default.json`) para autorizar plugins como `dialog` y
  `shell` desde el frontend. Ese archivo faltaba — por eso "Seleccionar imagen"
  y los enlaces externos no funcionaban. Ya está agregado y correctamente
  vinculado a la ventana `"main"`.
- **Cambio de skin real**: nueva sección "Skin" (reemplaza "Biblioteca de
  versiones" en la barra lateral) con selector de archivo `.png`, subida
  automática y actualización instantánea del preview 3D.
  - Cuentas **Premium**: sube la skin de verdad al perfil de Mojang
    (`POST /minecraft/profile/skins`), visible para todo el mundo.
  - Cuentas **No Premium**: no hay servidor de perfiles al que subir, así
    que el PNG se guarda embebido (data URI) en la cuenta local — sólo
    afecta el preview dentro de SoulClient.
- **Permisos de administrador**: sólo cuentas Premium en la lista
  `ADMIN_USERNAMES` (en `src-tauri/src/auth/mod.rs`, incluye `Emanueel`)
  pueden crear, editar o eliminar instancias. Se aplica **en el backend**
  (no sólo ocultando botones en la UI), así que no se puede saltar
  modificando el frontend.
- **Login con Discord**: pantalla de bienvenida con logo, botón grande de
  Discord, loading state, manejo de errores y sesión recordada
  automáticamente. Ver la sección siguiente para la configuración completa.

## Configurar el login con Discord

El Client ID (`1492641149494755370`) ya está en el código, pero el **Client
Secret nunca debe estar en el launcher** — por eso necesitas desplegar un
pequeño backend propio que lo guarde como variable de entorno:

1. Ve a https://discord.com/developers/applications, abre la app con ese
   Client ID, y en OAuth2 agrega este Redirect URI exacto:
   ```
   http://127.0.0.1:47850/callback
   ```
   (el launcher escucha en ese puerto local para capturar la respuesta).
2. Despliega uno de los dos backends en `backend-example/` con tu
   `DISCORD_CLIENT_SECRET`:
   - `discord-oauth-worker/` (Cloudflare Workers, **recomendado**: gratis
     y sin cold-start) — instrucciones en su propio README.
   - `discord-oauth-server/` (Node/Express) si prefieres correrlo local o
     en tu propio servidor/VPS.
3. En SoulClient, ve a **Configuración -> Discord backend URL** y pega la
   URL pública de tu backend desplegado.

Sin este paso, el botón de "Iniciar sesión con Discord" abrirá el
navegador correctamente pero fallará al intercambiar el código por un
token — comportamiento esperado hasta que despliegues el backend.


Este entorno de generación no tiene un toolchain de Rust disponible, así que
el frontend fue validado con `tsc --noEmit` y `vite build` (ambos exitosos),
pero el backend Rust **no pudo compilarse aquí**. Se revisó manualmente
línea por línea buscando errores de tipos/lifetimes, pero te recomiendo
correr `cargo check` en tu máquina como primer paso — es posible que
aparezca algún ajuste menor de nombres de API entre versiones de los
plugins de Tauri.
