---
name: store-msix
description: Empaquetar Maity Desktop como MSIX y publicarlo en la Microsoft Store para quitar el warning de SmartScreen en Windows (empresa MX). Úsalo cuando el usuario quiera generar el .msix, probarlo localmente, continuar el proceso en Partner Center, o resolver dudas de convivencia entre los dos canales de distribución (Store vs GitHub Releases): firma, updates, datos compartidos, doble instalación.
---

# Publicar Maity en la Microsoft Store (MSIX)

## Por qué esta ruta

Objetivo: **quitar el warning de SmartScreen** de Windows al instalar Maity.

- **Trusted Signing NO sirve**: geo-bloqueado (solo orgs de USA/CA/UE/UK). México no califica y no es configurable. El VPN no ayuda (la validación es documental).
- **La Microsoft Store SÍ**: al empaquetar como **MSIX**, Microsoft firma la app y la distribuye por canal confiable → **sin SmartScreen**. Partner Center está disponible en México (~$99 empresa, una vez).
- En Partner Center hay que elegir el tipo **"MSIX/PWA app"**, **NUNCA "EXE or MSI app"** (esa ruta la firmas tú → SmartScreen queda igual).
- Se puede mantener **en paralelo** el canal actual (GitHub Releases + auto-updater firmado con Certum) para descarga directa. La Store es un canal adicional.

## Datos de identidad (Partner Center — cuenta Sixale730, producto "Maity")

| Campo del manifest | Valor |
|---|---|
| `Package/Identity/Name` | `Sixale.Maity` |
| `Package/Identity/Publisher` | `CN=C88867C5-0981-430C-9134-4C455473D0F2` |
| `PublisherDisplayName` | `Maity AI` (cosmético; Microsoft lo puede sobrescribir) |
| Store ID | `9NTKJ5X6230F` |
| Package Family Name | `Sixale.Maity_q5b9hqhck1xz0` |

Solo `Name` y `Publisher` son "sagrados" (deben coincidir EXACTO o la Store rebota el paquete al subir).

## Prerrequisitos

```powershell
winget install microsoft.winappcli --source winget   # winapp CLI
```
- Cuenta Partner Center con el producto **"Maity"** reservado como **MSIX/PWA app**.
- LLVM para compilar whisper: `LIBCLANG_PATH = C:\Program Files\LLVM\bin`.

## Proceso paso a paso

### 1. Manifest (ya existe: `frontend/Package.appxmanifest`)

Si hay que regenerarlo: `winapp init frontend --use-defaults --setup-sdks none --no-gitignore` (crea skeleton + carpeta `Assets`), luego editar identidad + capabilities. El manifest debe tener:
- `<Identity Name="Sixale.Maity" Publisher="CN=C88867C5-..." Version="0.2.52.0" />` (Version en 4 partes).
  - **⚠️ El 4º dígito (revision) DEBE ser SIEMPRE 0 para la Store** (rebote real 2026-07-27): Partner Center rechaza el paquete al subirlo con *"Apps are not allowed to have a Version with a revision number other than zero specified in the app manifest"*. Ese dígito se lo **reserva Microsoft** — NO sirve para re-submissions. Una re-submission con el mismo código requiere bump de `Z` (X.Y.Z), aceptando que el semver MSIX se adelante al de Tauri si hace falta.
  - La versión debe ser **estrictamente mayor** que la publicada en la Store. La versión publicada NO se ve ni con `winget show` (da `Version: Unknown`) ni en la página del producto — consultarla en Partner Center.
- `<Application ... Executable="maity-desktop.exe" EntryPoint="Windows.FullTrustApplication">`.
- Capabilities: `<rescap:Capability Name="runFullTrust" />` + `<DeviceCapability Name="microphone" />`.
- **Autostart del canal Store** — `<Extensions>` dentro de `<Application>` (después de `<uap:VisualElements>`, el schema exige ese orden) con `<desktop:Extension Category="windows.startupTask">` → `<desktop:StartupTask TaskId="MaityStartup" Enabled="true" DisplayName="Maity" />`. Claves:
  - `TaskId="MaityStartup"` DEBE coincidir con `STARTUP_TASK_ID` en `src-tauri/src/startup_task.rs`. **No renombrarlo**: Windows persiste el estado (enabled/disabled) por TaskId; cambiarlo resetea la elección del usuario.
  - `Enabled="true"` de fábrica es válido en certificación para apps `runFullTrust` (la restricción de pedir consentimiento aplica solo a UWP puro). Plan B si certificación objetara: `Enabled="false"` + `RequestEnableAsync` (en desktop apps no muestra diálogo).
  - El startupTask lanza el exe **sin args** (a diferencia del `--autostart` que inyecta tauri-plugin-autostart en el canal NSIS) → `startup_task::launched_by_startup_task()` detecta el arranque-por-boot con WinRT `AppInstance::GetActivatedEventArgs()` (`ActivationKind::StartupTask`) para que `STARTED_AT_BOOT` funcione igual (ventana minimizada, patrón Steam).
  - Si el usuario apaga el task desde Task Manager/Configuración (`DisabledByUser`), la app NO puede reactivarlo — el toggle de Settings muestra el aviso y un link a `ms-settings:startupapps`.

### 2. Iconos reales (✅ HECHO — en `frontend/Assets/`)

`winapp init` genera iconos genéricos. Ya se reemplazaron con los reales de Maity, copiados de `frontend/src-tauri/icons/`:

| Destino en `frontend/Assets/` | Origen en `src-tauri/icons/` |
|---|---|
| `StoreLogo.png` | `StoreLogo.png` |
| `MedTile.png` | `Square150x150Logo.png` |
| `MedTile.scale-200.png` | `Square310x310Logo.png` |
| `AppList.png` | `Square44x44Logo.png` |
| `AppList.scale-200.png` | `Square89x89Logo.png` |
| `AppList.targetsize-24_altform-unplated.png` | `Square30x30Logo.png` |

⚠️ Si se vuelve a correr `winapp init`, los sobrescribe con placeholders → re-copiar.

### 2.5 Pre-flight: migraciones byte-idénticas a sus pins (CRÍTICO — incidente 2026-07-21)

`tauri build --no-bundle` directo **NO corre** los pre-build checks de `tauri:build:debug` — validar SIEMPRE antes de compilar:

```powershell
node frontend/scripts/verify-migrations-lf.js   # debe salir OK / exit 0
```

**La verdad canónica de cada migración son sus BYTES pinneados en el `.sha384`** (los que embebió el release que la aplicó en las DB de los usuarios) — NO es "todo LF": históricamente es una MEZCLA (las 16 primeras CRLF, las posteriores LF). Reglas:
- **NUNCA normalizar line endings de migraciones** (ni a LF ni a CRLF) — cambia los bytes → el binario arranca en usuarios existentes con **"migration N was previously applied but has been modified"**. Eso NO es corrupción de DB: el paquete es el que está mal; **no restablecer la base** del usuario.
- `.gitattributes` las marca `-text` (bytes congelados, git no las convierte). No quitar esa línea.
- Migración nueva → generar su pin con `scripts/migrations-regen-checksums.sh` y commitear `.sql` + `.sha384` juntos. Jamás regenerar el pin de una migración ya aplicada.
- `pnpm run tauri:build:store` (frontend) encadena esta verificación + `tauri build --no-bundle` — usar ese comando en lugar del build crudo.

### 3. Compilar con frontend EMBEBIDO (CRÍTICO)

**Usar `tauri build`, NO `cargo build` crudo.** Un `cargo build` debug apunta el webview a `localhost:3118` (dev server) → pantalla de error. `tauri build` embebe el frontend. `--no-bundle` salta los instaladores NSIS/MSI y la firma Certum (no la necesitamos para MSIX).

```powershell
$env:LIBCLANG_PATH='C:\Program Files\LLVM\bin'
pnpm -C frontend run tauri:build:store    # verify-migrations + tauri build --no-bundle (release)
# variante debug para pruebas: pnpm -C frontend exec tauri build --debug --no-bundle (correr verify-migrations a mano antes)
```

El exe queda en **`C:\maity_desktop\target\debug\maity-desktop.exe`** (¡el `target` está en la RAÍZ del workspace, no en `src-tauri/`!). Nombre del exe = `maity-desktop.exe` (nombre del paquete Cargo).

### 4. Stagear el payload

Copiar a un folder de staging (junto al manifest):
- `maity-desktop.exe` + `llama-helper.exe` → de `target/release/` (o `target/debug/`).
- `ffmpeg.exe` + `ffprobe.exe` → **de `target/debug/`** (⚠️ el build release con `--no-bundle` NO copia ffmpeg al output; se necesitan para guardar grabaciones — encode PCM→AAC/MP4).
- **`msvcp140.dll`, `msvcp140_1.dll`, `vcruntime140.dll`, `vcruntime140_1.dll`** → de `frontend/src-tauri/vcredist/` (los deja ahí `scripts/stage-vcredist.js`, que corre dentro de `tauri:build:store`). **OBLIGATORIOS** — sin ellos la app no arranca en un Windows limpio; es lo que rebotó la certificación 10.2.4.1 (ver Gotchas).
- `Package.appxmanifest` (⚠️ el **fresco** de `frontend/`, no el que quedó en el staging de la corrida anterior: se desfasa en cada bump de versión), `Assets/`, `templates/` (de `frontend/src-tauri/templates/`).
- **NO** hace falta `app_lib.dll` (el exe enlaza el lib estático) ni `WebView2Loader.dll` (Tauri 2 lo enlaza estático).

Verificar antes de empaquetar que el staging tenga los 4 DLLs y que el manifest sea el de la versión que estás publicando:
```powershell
Get-ChildItem <staging>\*.dll | Select-Object Name, Length
Select-String -Path <staging>\Package.appxmanifest -Pattern 'Version='
```

### 5. Iterar rápido con `winapp run` (opcional — loop de desarrollo)

```powershell
winapp run "<staging>" --detach --exe maity-desktop.exe
```
Registra identidad de paquete desde archivos sueltos y lanza Maity — **sin validar firma, cero certificados** (por eso esta ruta no pide nada). Útil para iterar: recompilar → copiar exe al staging → `winapp run` otra vez. Recordar el gotcha del `AppX\` (ver Gotchas: hay que re-copiar a mano ffmpeg/ffprobe/llama-helper/templates **y los 4 DLLs del VC++ Runtime**). Limpiar después:
```powershell
taskkill /F /IM maity-desktop.exe
Get-AppxPackage -Name Sixale.Maity | Remove-AppxPackage
```
✅ Validado 2026-07-16: el audio (incl. WASAPI loopback del sistema) funciona bajo el contenedor MSIX.

### 6. Generar el MSIX real

```powershell
# Primera vez (o si no existe el pfx): genera cert de dev nuevo
winapp package "<staging>" --manifest "<staging>\Package.appxmanifest" --generate-cert
# Corridas siguientes: REUSAR el pfx para no re-confiar el cert en cada iteración
winapp package "<staging>" --manifest "<staging>\Package.appxmanifest" --cert C:\maity_desktop\signing\Sixale.Maity_cert.pfx --cert-password password
```
⚠️ **`winapp package` escribe el `.msix` DENTRO del directorio de staging** (verificado 2026-08-13: salió en `msix_staging\Sixale.Maity_0.2.56.0_x64.msix`, NO en la raíz del repo como decía esta guía). Como el staging **ES el payload**, dejarlo ahí hace que la corrida siguiente empaquete el `.msix` anterior dentro del nuevo (paquete al doble de tamaño). **Moverlo a la raíz del repo inmediatamente después de generarlo** y confirmar que el staging quedó solo con binarios/DLLs/manifest/`Assets/`/`templates/`.

El cert de dev es solo para instalar local; **NO firmar con Certum** — Microsoft firma el MSIX al subirlo a la Store.

⚠️ `--generate-cert` crea un cert NUEVO cada corrida (habría que re-confiarlo cada vez) y deja **`Sixale.Maity_cert.pfx`** en la raíz del repo (llave privada; password por defecto de winapp: `password`). Por eso: generarlo UNA vez, confiar su `.cer` una vez (§6.5) y de ahí en adelante empaquetar con `--cert`. **NO abrir el pfx para instalar el cert** (usar el `.cer` exportado), **NO commitearlo**. `/msix_staging/` y `*.msix` ya están en `.gitignore`.

> 🔴 **Los certificados viven en `signing/` (gitignored), NUNCA dentro del staging.**
> El directorio de staging **ES el payload del paquete**: todo lo que esté ahí acaba
> dentro del `.msix`. Pasó de verdad — el paquete 0.2.53 del 2026-07-27 se empaquetó
> con `Sixale.Maity_cert.pfx` (2632 bytes, **llave privada**) y `maity-dev.cer`
> adentro, y estuvo a punto de subirse a Partner Center. Antes de cada
> `winapp package`, verificar que el staging solo tenga binarios, DLLs, manifest,
> `Assets/` y `templates/`:
> ```powershell
> Get-ChildItem <staging> -Recurse -Include *.pfx,*.cer,*.key,*.env   # debe salir vacio
> ```
>
> 🔴 **Misma regla para los residuos de corridas previas — hay DOS que reaparecen solos:**
> - **`<staging>\AppX\`** (~262 MB): lo crea `winapp run` con una copia del payload (ver Gotchas).
>   Si sigue ahí al empaquetar, el `.msix` lleva el payload DUPLICADO.
> - **`<staging>\Sixale.Maity_*.msix`**: lo deja el propio `winapp package` (ver §6).
>
> Ambos se acumulan en silencio — el paquete solo sale "raro de grande". Antes de cada
> `winapp package`, el staging debe tener EXACTAMENTE: los 4 `.exe`, los 4 `.dll` del VC++
> Runtime, `Package.appxmanifest`, `Assets/` y `templates/`. Nada más:
> ```powershell
> Get-ChildItem <staging> | Select-Object Name, Length   # 11 entradas, sin AppX ni .msix
> ```
> Y comprobar el paquete ya generado (es un zip):
> ```powershell
> Add-Type -AssemblyName System.IO.Compression.FileSystem
> $z=[System.IO.Compression.ZipFile]::OpenRead('<repo>\Sixale.Maity_<ver>_x64.msix')
> $z.Entries | Where-Object { $_.FullName -match '\.(pfx|cer|key)$' }   # debe salir vacio
> $z.Dispose()
> ```

### 6.5 Probar el MSIX instalándolo (OBLIGATORIO antes de subir a la Store)

**Flujo estándar desde 2026-07-21:** todo `.msix` se prueba instalado localmente ANTES de subirse a Partner Center. A diferencia de `winapp run`, el doble clic al `.msix` **sí valida la firma** → hay que confiar el cert de dev UNA vez (síntoma si falta: instalador con "Editor: Desconocido", botón Instalar deshabilitado y error `0x800B010A`).

1. **Extraer el cert público del propio `.msix`** (sin contraseña, a diferencia del .pfx). Destino `signing/` (gitignored), **NUNCA `<staging>`** — lo que cae en el staging viaja dentro del paquete:
   ```powershell
   $sig = Get-AuthenticodeSignature '<repo>\Sixale.Maity_<version>_x64.msix'
   [System.IO.File]::WriteAllBytes('<repo>\signing\maity-dev.cer', $sig.SignerCertificate.Export('Cert'))
   ```
2. **Confiarlo** (una vez por certificado; requiere admin — lo hace el USUARIO, no el agente: es un cambio de confianza de la máquina):
   - GUI: doble clic al `.cer` → Instalar certificado… → **Equipo local** → almacén **Personas de confianza** (Trusted People).
   - O en PowerShell elevado: `Import-Certificate -FilePath <repo>\signing\maity-dev.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople`
   - ⚠️ Si `winapp package` regenera el cert en una corrida futura, hay que re-confiar el `.cer` nuevo.
3. **Cerrar cualquier instancia de Maity corriendo** (single-instance) y doble clic al `.msix` → Instalar.
   - ⚠️ **Reinstalar la MISMA versión falla** (Windows rechaza un paquete con versión idéntica a la instalada pero contenido distinto). Al iterar: `Get-AppxPackage -Name Sixale.Maity | Remove-AppxPackage` ANTES de instalar el `.msix` regenerado.
   - **⚠️ Remove-AppxPackage BORRA los datos del usuario** (corregido 2026-07-27): el MSIX instalado guarda TODO (SQLite, modelos, config) en `%LOCALAPPDATA%\Packages\Sixale.Maity_q5b9hqhck1xz0\LocalCache\Roaming\com.maity.ai`, y quitar el paquete se lleva esa carpeta. En una máquina con datos reales: **respaldar `LocalCache\Roaming\com.maity.ai` antes** de desinstalar, y restaurarlo tras reinstalar.
   - **⚠️ NO bumpear el 4º dígito para iterar localmente** (incidente 2026-07-27): un sideload de prueba `X.Y.Z.1` instala local bien, pero (a) la Store solo acepta `X.Y.Z.0` → el paquete de prueba y el de la Store divergen, y (b) esa instalación local **eclipsa la versión de la Store del mismo X.Y.Z** (0.2.53.1 local > 0.2.53.0 Store → la Store nunca la actualiza y la máquina se queda con el build dev). Iterar con Remove-AppxPackage (con respaldo de datos), no con bumps de revision.
4. **Smoke test instalado**: arranca desde el menú inicio, login, grabar (mic + sistema), guardar, onboarding si aplica. Esta prueba es fiel al canal Store salvo por la firma (la de la Store es de Microsoft — el usuario final nunca ve el diálogo de certificado).
5. **Limpieza** al terminar: `Get-AppxPackage -Name Sixale.Maity | Remove-AppxPackage` (⚠️ con respaldo previo de `LocalCache\Roaming\com.maity.ai` si la instalación acumuló datos que importan); opcionalmente quitar el cert en `certlm.msc` → Personas de confianza; borrar el `.pfx`.

### 7. Subir a la Store (Partner Center — walkthrough con respuestas para Maity)

Tipo de producto: **MSIX/PWA app** (NO "EXE or MSI app", NO Add-ons). El `.msix` va en la sección **Packages** del submission, no en Add-ons.

Completar TODAS las secciones (todas en verde para poder Submit):

**Packages** → subir el `.msix`, esperar validación verde.

**Pricing and availability:**
- Markets: **All worldwide markets** (Recommended) + "available in any future market" ✅.
- Visibility: **Public audience** + **discoverable in the Microsoft Store**.
- Base/Retail price: **$0 = Free** (el warning "must configure a price" se quita al poner 0 + Save).
- Free trial: No.

**Properties:**
- Category: **Productivity**.
- **Privacy policy URL: `https://www.maity.cloud/privacidad`** (OBLIGATORIA — la app graba audio). Website `https://www.maity.cloud`, Support `https://www.maity.cloud/soporte`.
- ⚠️ **Display mode: DESMARCAR "PC" y "HoloLens"** — Maity NO es Windows Mixed Reality/VR. Si quedan marcados, sale error rojo pidiendo hardware de MR immersive headset. Desmarcados = error resuelto.
- Product declarations: **marcar "generative AI features"** (Maity genera resúmenes con IA); **desmarcar** "record and broadcast clips of this game" (no es juego; de todos modos es inerte fuera de categoría Games); el resto opcional.
- System requirements: **Microphone** marcado; MR headset/controllers desmarcados; memoria/DirectX/video/CPU/GPU son opcionales.

**Age ratings (IARC):**
- App Type: **"All Other App Types"** (NO Game, NO Social/Communication — Maity es herramienta de productividad, no conecta personas).
- Contenido: todo **No** (violencia, sexo, lenguaje, drogas, apuestas, ubicación, compras). User Content Sharing: No. Downloaded App: No.
- **Online Content: Yes** — Maity genera "generated AI content" (es uno de los ejemplos de la pregunta); consistente con la declaración de genAI. No sube la clasificación.
- Resultado: **3+ / Everyone**.

**Store listings:**
- El paquete declara `en-us` (del `<Resource Language="en-us"/>` del manifest), así que **English (US)** aparece como idioma del paquete y hay que completar esa listing.
- Para agregar español: botón **"Manage additional languages"** → **Spanish (Mexico)**. (NO se agrega en la lista "Languages supported in packages", que es fija según el manifest.) Si se quiere español como idioma del paquete, cambiar el manifest a `<Resource Language="es-MX"/>` y regenerar el `.msix`.
- Cada listing: nombre, descripción corta/larga, **mínimo 1 captura** de la app.

**Restricted capabilities (runFullTrust):** Microsoft exige justificar. Límite **~500 caracteres**. Texto probado que funciona:
> Maity is a Win32 desktop app (Rust/Tauri) packaged as MSIX. It needs runFullTrust for native features unavailable in the AppContainer sandbox: WASAPI audio capture (mic + system loopback) to record meetings; on-device speech-to-text via native libraries (whisper.cpp, ONNX Runtime); running FFmpeg to encode audio; and a local LLM for on-device summaries. All processing runs locally for privacy.

**Submission notification audience:** dejar default. Finalmente: **Submit for certification** (Microsoft escanea malware + revisa; runFullTrust se aprueba con la justificación de arriba).

✅ **PUBLICADO** — Maity está live en la Store desde jul-2026.

## Después de publicar: convivencia de los dos canales

Maity se distribuye por **dos canales en paralelo** desde un mismo código fuente:

| Canal | Artefacto | Firma | SmartScreen | Updates |
|---|---|---|---|---|
| Microsoft Store | `.msix` | **Microsoft** (re-firma al subir) | ✅ Ninguno | Las aplica la Store; la app solo **avisa** (ver "Go-live" abajo) |
| GitHub Releases | `.exe` NSIS | Certum/SimplySign | ⚠️ Sí (hasta ganar reputación) | Tauri updater (minisign) |

### No se puede auto-hospedar el MSIX

Microsoft **no te devuelve** el paquete firmado — esa versión vive solo dentro del canal de la Store. El `.msix` local (generado con `--generate-cert`) usa un **cert autofirmado de dev**: instala en tu máquina, pero Windows lo rechaza en cualquier otra.

Firmarlo con Certum tampoco sirve: (a) un `.msix` bajado del navegador arrastra Mark of the Web → vuelve el SmartScreen, y (b) `Identity/Publisher` debe coincidir EXACTO con el subject del cert que firma, y `CN=C88867C5-...` es el que **asignó Microsoft** → cambiarlo crea **otra identidad de paquete** = app distinta = instalación duplicada.

**Desde maity.cloud, enlazar a la Store:**
```
Página de producto:  https://apps.microsoft.com/detail/9NTKJ5X6230F
Deep link (Windows): ms-windows-store://pdp/?ProductId=9NTKJ5X6230F
CLI:                 winget install 9NTKJ5X6230F --source msstore
```
(En código estas constantes viven en `frontend/src/lib/storeChannel.ts`.)

### Go-live: avisar a los usuarios que hay versión nueva (`desktop_store_latest_version`) — #71

La Store **no** reemplaza un MSIX que está corriendo (descarga en background y aplica al siguiente cierre) y el updater de GitHub está apagado bajo identidad de paquete. Desde ago-2026 la app **avisa** ella misma: `updateService` (rama `channel: 'store'`) compara `getVersion()` contra la fila `maity.system_config['desktop_store_latest_version']` y, si hay versión mayor, abre el `UpdateDialog` con "Abrir la Store" (`ms-windows-store://downloadsandupdates`) y "Cerrar Maity para actualizar" (se niega con grabación viva). **No descarga nada.**

- **NO se usa el `latest.json` de GitHub**: sigue al canal NSIS, que va DETRÁS de la Store (ago-2026: GitHub v0.2.52 vs Store 0.2.57) → diría "al día" para siempre.
- **Bumpear la fila SOLO cuando Partner Center marque la submission como publicada** ("En la Store"), nunca al enviarla: la certificación tarda días y avisar antes manda al usuario a una Store que aún no tiene la versión.
- `public.admin_update_system_config` **no sirve** (es UPDATE-only con whitelist `billing_%`/`rate_limit_%`). Se hace con SQL directo (Supabase MCP `execute_sql` o SQL editor, rol postgres):

```sql
insert into maity.system_config (key, value, description)
values ('desktop_store_latest_version', '0.2.58',
        'Última versión de Maity Desktop publicada en la Microsoft Store. Bumpear SOLO cuando Partner Center la marque como publicada. La lee updateService bajo MSIX (#71).')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

- Verificación post-go-live (criterio del issue): `select app_version, count(distinct user_id) from maity.platform_logs where event_type = 'app.open' and created_at > now() - interval '1 day' group by 1;` — los usuarios deben converger a la nueva versión en ≤1 día hábil.
- Chicken-and-egg: el aviso existe desde la versión que lo incluye; los usuarios en versiones anteriores necesitan el workaround manual una última vez (cerrar Maity → Store → Biblioteca → "Obtener actualizaciones" → reabrir).

### ⚠️ Los dos canales NO comparten los datos (CORREGIDO 2026-07-27)

**El MSIX INSTALADO SÍ redirige AppData** a `%LOCALAPPDATA%\Packages\Sixale.Maity_q5b9hqhck1xz0\LocalCache\Roaming\com.maity.ai` (ahí viven SQLite, modelos y config de la instancia MSIX — verificado 2026-07-27 en la máquina de desarrollo: el perfil `%APPDATA%\com.maity.ai` estaba casi vacío mientras LocalCache tenía la DB y 1.6 GB de modelos).

**La verificación del 2026-07-20 que decía lo contrario estaba mal** — se hizo con `winapp run`, que registra el paquete desde archivos sueltos y **NO redirige** (por eso las escrituras caían en `%APPDATA%`). El comportamiento difiere entre las dos rutas:

| Ruta | ¿Redirige AppData? | Datos en |
|---|---|---|
| `winapp run` (archivos sueltos) | ❌ No | `%APPDATA%\com.maity.ai` |
| `.msix` INSTALADO (doble clic / Store) | ✅ Sí | `...\Sixale.Maity_q5b9hqhck1xz0\LocalCache\Roaming\com.maity.ai` |

Implicaciones:

- ❌ Migrar de descarga directa (NSIS) → Store **NO conserva** DB, modelos (~1.5 GB) ni config: la instancia Store arranca desde cero (re-onboarding, re-descarga de modelos). Si algún día importa, habría que escribir un importador o copiar la carpeta a mano.
- ✅ NSIS y Store instalados a la vez ya NO contienden por la misma SQLite (cada uno tiene la suya) — pero sigue el resto de problemas de la doble instalación (ver sección de riesgo).
- ⚠️ `Remove-AppxPackage` **borra LocalCache** → borra los datos del usuario de la instancia MSIX (ver §6.5).

### Migraciones: aditivas de todos modos

Aunque los canales ya no compartan DB, **mantener las migraciones ADITIVAS**: un usuario puede copiar su DB entre perfiles (o entre máquinas/canales), y dentro de un mismo canal la Store va días atrás por certificación — una DB migrada por un build nuevo puede acabar abierta por uno viejo. `set_ignore_missing(true)` (`database/manager.rs`, v0.2.51) cubre el crash `SQLx VersionMissing`, pero NO salva de un DROP/RENAME.

### Auto-updater gateado (ya implementado)

Bajo MSIX el updater de GitHub instalaría una **segunda copia Win32** en paralelo a la de la Store. Gateado con:

- `src-tauri/src/utils.rs` → `is_running_under_package_identity()`. Usa `GetCurrentPackageFullName` con buffer nulo: `ERROR_INSUFFICIENT_BUFFER` (122) = proceso empaquetado; `APPMODEL_ERROR_NO_PACKAGE` (15700) = no.
- `src/services/updateService.ts` → invoca el comando y salta el check si es MSIX (cubierto en `updateService.test.ts`).

### Riesgo abierto: doble instalación

Un usuario puede terminar con NSIS **y** Store a la vez → dos entradas en el menú inicio, dos autostart, contención del micrófono, y datos PARTIDOS en dos perfiles (cada instancia tiene su propia SQLite desde la corrección 2026-07-27: NSIS en `%APPDATA%`, MSIX en `LocalCache` — el usuario ve "reuniones que desaparecen" según cuál abra). El escenario de version-skew sobre una MISMA DB solo aplica ya dentro de un canal (downgrade o DB copiada a mano); lo cubre `set_ignore_missing(true)` (v0.2.51, `database/manager.rs`) para versiones ≥0.2.51.

- **Mitigación primaria (sin código):** en maity.cloud el botón principal apunta a la Store; el `.exe` de GitHub queda como link secundario ("instalación offline / empresas"). Si casi nadie instala ambas, el problema no existe.
- **✅ Mitigación en código — IMPLEMENTADA Y VERIFICADA (Store→quitar NSIS, jul-2026):** al arrancar bajo identidad de paquete (MSIX), Maity detecta la instalación NSIS rival y **exige** quitarla (diálogo forzado, sin opción de posponer). Solo se cubre esta dirección (la Store es siempre el canal sobreviviente). Piezas:
  - **Rust** `src-tauri/src/rival_install.rs` (dep `winreg`):
    - `get_rival_install()` — lee `HKCU`/`HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Maity`; solo devuelve `Some` si `is_running_under_package_identity()`.
    - `uninstall_rival()` — **NO corre el uninstaller in-process.** Escribe un orquestador `.cmd` a `%LOCALAPPDATA%\Maity\rival-cleanup.cmd` y lo lanza con `cmd.exe /c` **desacoplado del job MSIX** (`creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB)`). El `.cmd`: corre `uninstall.exe /S` → poll `reg query` hasta que la clave de desinstalación desaparezca → borra el autostart huérfano `Run\Maity` → **relanza la MSIX** por su AUMID (`GetCurrentApplicationUserModelId`, fallback `Sixale.Maity_q5b9hqhck1xz0!Maity`) vía `explorer.exe shell:AppsFolder\<AUMID>`. Loguea a `%LOCALAPPDATA%\Maity\logs\rival-cleanup.log`.
  - **⚠️ POR QUÉ el orquestador externo (gotcha clave):** el uninstaller NSIS hace `taskkill /im maity-desktop.exe` **por nombre de imagen** → cierra también la app MSIX que corre (mismo nombre de exe; **verificado empíricamente** que la mata aunque corra desde `Program Files\WindowsApps`). No se puede evitar el cierre → el orquestador debe sobrevivir al kill y reabrir la app. **NO combinar `DETACHED_PROCESS` con `CREATE_NO_WINDOW`** (flags de consola mutuamente excluyentes → CreateProcess deja el proceso inválido y el orquestador nunca ejecuta — bug real que costó una iteración). Se descartó `schtasks`/PowerShell `-ExecutionPolicy Bypass` (banderas rojas de persistence/security).
  - **Frontend** `src/components/rival-install/RivalInstallDialog.tsx` — pull-based (invoca `get_rival_install` al montar, solo Windows), modal shadcn **forzado** (sin botón "Más tarde", no descartable por X/Esc/click-fuera). Al confirmar: persiste flag `rival-install-just-removed.json` ANTES de invocar (sobrevive al kill) → toast de éxito al re-arrancar; además hace polling de `get_rival_install` como red por si la app no muriera. Montado en `layout.tsx` junto a `MeetingDetectionDialog`.
  - **Blindaje de doble-autostart:** `useAutostartBootstrap.ts` **salta** el registro de autostart bajo MSIX (evita un segundo `HKCU\...\Run\Maity`). El "iniciar con el PC" de la versión Store ✅ ya existe vía el `<desktop:StartupTask TaskId="MaityStartup" Enabled="true">` del manifest (ver §1), y el toggle de `PreferenceSettings.tsx` es funcional bajo MSIX vía los comandos `startup_task_*`. Convivencia NSIS+Store: habría Run key + startupTask a la vez (doble arranque), pero el diálogo forzado desinstala el NSIS y su `.cmd` borra el `Run\Maity` huérfano.
- **⚠️ SIN VERIFICAR:** si el lock de single-instance de Tauri cruza el límite de identidad de paquete. Si NO cruza, ambas instancias corren simultáneas. Para probarlo hace falta una máquina con el NSIS instalado + el MSIX registrado.

### Certum/SimplySign: qué pasa si se deja caducar

- La **Store no se ve afectada** (firma Microsoft).
- Los binarios **ya publicados siguen confiables**: `src-tauri/scripts/sign-windows.ps1` firma con **sello de tiempo RFC 3161** (`/tr http://time.certum.pl /td SHA256`), y el timestamp congela la validez más allá del vencimiento del certificado.
- Solo los **builds nuevos** de descarga directa quedarían sin firmar → vuelve el SmartScreen.
- El **updater NO se rompe**: el `.sig` usa la llave **minisign de Tauri** (`TAURI_SIGNING_PRIVATE_KEY` / `pubkey` en `tauri.conf.json`), totalmente independiente de Certum.
- Los usuarios de descarga directa **NO migran solos** a la Store (identidad de paquete distinta) → mantener ambos canales hasta que la base se haya movido.

## Gotchas (aprendidos 2026-07-16)

- **⚠️ El VC++ Runtime debe ir DENTRO del paquete** (incidente de certificación 2026-07-17). El reporte volvió **"Pass with required fix"** con la política **10.2.4.1 Security - Software Dependencies** (*"Undisclosed software: C++"*) y una captura del crash real en la máquina de certificación: `The code execution cannot proceed because MSVCP140.dll was not found`.
  - **Causa:** el binario es Rust pero enlaza C++ compilado con `/MD` (whisper.cpp, ONNX Runtime, `llama-helper`) → depende de `MSVCP140.dll` / `MSVCP140_1.dll` / `VCRUNTIME140.dll` / `VCRUNTIME140_1.dll`. **En cualquier máquina de desarrollo ese runtime ya está instalado** (lo meten VS, Office, Steam, juegos) — por eso el bug fue invisible durante meses. **La máquina de certificación es un Windows limpio.** El `.exe` NSIS de GitHub Releases tenía exactamente el mismo bug.
  - **Fix (implementado):** `frontend/scripts/stage-vcredist.js` copia los 4 DLLs del VC Redist del VS Build Tools a `frontend/src-tauri/vcredist/` (gitignored, se regenera en cada build para que la versión coincida con el toolset que compiló). Corre dentro de `run-pre-build-checks.js` y de `tauri:build:store`. Para NSIS/MSI los reparte `frontend/src-tauri/tauri.windows.conf.json` (`bundle.resources` en forma de **mapa**, destino `""` = raíz del resource dir = el dir del `.exe`); para MSIX se copian a mano al staging (§4).
  - **Se cumple la política eliminando la dependencia, no declarándola** — no hay que tocar la descripción de la Store.
  - **Regla general:** todo `.dll` del que dependa un binario del paquete tiene que viajar dentro. Las `api-ms-win-crt-*.dll` son la excepción: son la UCRT, parte de Windows 10+ (el manifest exige `MinVersion 10.0.18362`). Para auditar el cierre de dependencias de un payload:
    ```bash
    cd <staging>
    for f in *.exe *.dll; do grep -aoiE '(msvcp|vcruntime|concrt)[a-z0-9_]*\.dll' "$f"; done | sort -u
    ```
    Todo lo que salga debe existir en esa carpeta.

- **⚠️ `winapp run` NO registra el staging tal cual** (descubierto 2026-07-20): construye una subcarpeta `<staging>\AppX\` con SOLO lo que el manifest declara (exe + `Assets\` + pri) y **descarta el payload suelto** (ffmpeg.exe, ffprobe.exe, llama-helper.exe, templates\, y los 4 DLLs del VC++ Runtime). Síntoma: la app corre y transcribe, pero `recording_saver` truena en cada chunk con `Failed to spawn FFmpeg process: os error 2` (miles de errores) y el coach no arranca (sidecar ausente). **Fix: DESPUÉS de `winapp run`, copiar esos elementos dentro de `<staging>\AppX\`** — funciona en caliente con la app corriendo (CreateProcess busca primero en el dir del exe; el incremental saver retiene el PCM en RAM y drena el backlog al aparecer ffmpeg, sin pérdida de audio). ⚠️ Los DLLs del VC++ Runtime son la excepción: se cargan al **arrancar** el proceso, así que copiarlos en caliente no sirve — tienen que estar en `AppX\` antes de lanzar. Verificar en logs (`%LOCALAPPDATA%\Maity\logs\`) que los `Saved checkpoint N` fluyan cada 30s sin errores.

- **⚠️ La redirección de AppData bajo MSIX SÍ existe en el paquete INSTALADO** (corregido 2026-07-27; la verificación del 07-20 que decía que no se hizo con `winapp run`, que no redirige). Datos de la instancia MSIX: `%LOCALAPPDATA%\Packages\Sixale.Maity_q5b9hqhck1xz0\LocalCache\Roaming\com.maity.ai`. Consecuencias: los canales NO comparten datos, `Remove-AppxPackage` los borra, y una prueba con `winapp run` NO es representativa de dónde escribe la app instalada. Ver sección de convivencia de canales.
- **⚠️ Partner Center: el 4º dígito de `Identity/Version` DEBE ser 0** (rebote 2026-07-27): *"Apps are not allowed to have a Version with a revision number other than zero"*. El revision se lo reserva Microsoft; re-submission con el mismo código = bump de `Z`. Corolarios: (a) NO iterar pruebas locales bumpeando el 4º dígito — ese sideload eclipsa a la futura versión de la Store del mismo X.Y.Z y la máquina se queda con el build dev; (b) la versión publicada en la Store no se ve con `winget show` (da `Version: Unknown`) ni en la página del producto — consultarla en Partner Center antes de elegir versión.
- **⚠️ Mostrar precios en la app exige la declaración de compras** (rebote 2026-07-29, política **10.8.2 Third-Party In-Product Purchases**, encontrada en "Ver planes y precios"): aunque el checkout Pro abre el navegador externo (handoff a maity.cloud), basta con que la app *muestre* la oportunidad de gastar dinero. **Fix (sin tocar código ni paquete):** en la submission → **Properties → Product declarations** → checkbox *"This app allows users to make purchases, but does not use the Microsoft Store commerce system"* (aparece como aviso de texto bajo el botón Get de la ficha). En el mismo reporte vino la nota **10.8.4** (describir limitaciones del plan gratuito/trial en la descripción) → cubierta añadiendo el párrafo final de la Description: límites de uso diarios/mensuales del plan Free + Pro se contrata fuera de la app (ver `store_listing_assets/textos-es.md` y `textos-en.md`; sin cifras — las cuotas son JSONB runtime en `maity.billing_plans` y números impresos driftearían). NO afirmar "grabación ilimitada" en la ficha (corrección de Julio 07-29).
- **`tauri build`, no `cargo build`** — cargo build debug → webview busca `localhost:3118`.
- **`target` en la raíz del workspace** (`C:\maity_desktop\target`), no en `src-tauri/`.
- `winapp init` deja **iconos placeholder** → reemplazar por el de Maity.
- Al `taskkill` la app, un **lock transitorio del plugin single-instance** puede matar el siguiente arranque → reintentar `winapp run`.
- El **sandbox del shell** bloquea `Remove-Item` y `-Recurse -Force` juntos → usar `Copy-Item` con `-Force` en un solo archivo, o robocopy.
- Para **producción** usar `--release` (no `--debug`) y evaluar features GPU (`--features cuda`) — aunque para la Store un build CPU/genérico es más portable.
- `WebView2` runtime debe estar en la máquina del usuario (evergreen, normalmente presente en Win11).

## Referencias
- Guía oficial winapp CLI + Tauri: https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/guides/tauri
- Distribución Tauri → Store: https://v2.tauri.app/distribute/microsoft-store/
