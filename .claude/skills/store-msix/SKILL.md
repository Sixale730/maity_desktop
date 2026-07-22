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
- `<Application ... Executable="maity-desktop.exe" EntryPoint="Windows.FullTrustApplication">`.
- Capabilities: `<rescap:Capability Name="runFullTrust" />` + `<DeviceCapability Name="microphone" />`.

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
- `Package.appxmanifest`, `Assets/`, `templates/` (de `frontend/src-tauri/templates/`).
- **NO** hace falta `app_lib.dll` (el exe enlaza el lib estático) ni `WebView2Loader.dll` (Tauri 2 lo enlaza estático).

### 5. Iterar rápido con `winapp run` (opcional — loop de desarrollo)

```powershell
winapp run "<staging>" --detach --exe maity-desktop.exe
```
Registra identidad de paquete desde archivos sueltos y lanza Maity — **sin validar firma, cero certificados** (por eso esta ruta no pide nada). Útil para iterar: recompilar → copiar exe al staging → `winapp run` otra vez. Recordar el gotcha del `AppX\` (ver Gotchas). Limpiar después:
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
winapp package "<staging>" --manifest "<staging>\Package.appxmanifest" --cert C:\maity_desktop\Sixale.Maity_cert.pfx --cert-password password
```
Genera `Sixale.Maity_<version>_x64.msix` en la raíz del repo. El cert de dev es solo para instalar local; **NO firmar con Certum** — Microsoft firma el MSIX al subirlo a la Store.

⚠️ `--generate-cert` crea un cert NUEVO cada corrida (habría que re-confiarlo cada vez) y deja **`Sixale.Maity_cert.pfx`** en la raíz del repo (llave privada; password por defecto de winapp: `password`). Por eso: generarlo UNA vez, confiar su `.cer` una vez (§6.5) y de ahí en adelante empaquetar con `--cert`. **NO abrir el pfx para instalar el cert** (usar el `.cer` exportado), **NO commitearlo**. `/msix_staging/` y `*.msix` ya están en `.gitignore`.

### 6.5 Probar el MSIX instalándolo (OBLIGATORIO antes de subir a la Store)

**Flujo estándar desde 2026-07-21:** todo `.msix` se prueba instalado localmente ANTES de subirse a Partner Center. A diferencia de `winapp run`, el doble clic al `.msix` **sí valida la firma** → hay que confiar el cert de dev UNA vez (síntoma si falta: instalador con "Editor: Desconocido", botón Instalar deshabilitado y error `0x800B010A`).

1. **Extraer el cert público del propio `.msix`** (sin contraseña, a diferencia del .pfx):
   ```powershell
   $sig = Get-AuthenticodeSignature '<repo>\Sixale.Maity_<version>_x64.msix'
   [System.IO.File]::WriteAllBytes('<staging>\maity-dev.cer', $sig.SignerCertificate.Export('Cert'))
   ```
2. **Confiarlo** (una vez por certificado; requiere admin — lo hace el USUARIO, no el agente: es un cambio de confianza de la máquina):
   - GUI: doble clic al `.cer` → Instalar certificado… → **Equipo local** → almacén **Personas de confianza** (Trusted People).
   - O en PowerShell elevado: `Import-Certificate -FilePath <staging>\maity-dev.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople`
   - ⚠️ Si `winapp package` regenera el cert en una corrida futura, hay que re-confiar el `.cer` nuevo.
3. **Cerrar cualquier instancia de Maity corriendo** (single-instance + SQLite compartida) y doble clic al `.msix` → Instalar.
   - ⚠️ **Reinstalar la MISMA versión falla** (Windows rechaza un paquete con versión idéntica a la instalada pero contenido distinto). Al iterar sin bump de versión: `Get-AppxPackage -Name Sixale.Maity | Remove-AppxPackage` ANTES de instalar el `.msix` regenerado (los datos sobreviven — viven en `%APPDATA%\com.maity.ai`, fuera del paquete).
4. **Smoke test instalado**: arranca desde el menú inicio, login, grabar (mic + sistema), guardar, onboarding si aplica. Esta prueba es fiel al canal Store salvo por la firma (la de la Store es de Microsoft — el usuario final nunca ve el diálogo de certificado).
5. **Limpieza** al terminar: `Get-AppxPackage -Name Sixale.Maity | Remove-AppxPackage`; opcionalmente quitar el cert en `certlm.msc` → Personas de confianza; borrar el `.pfx`.

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
| Microsoft Store | `.msix` | **Microsoft** (re-firma al subir) | ✅ Ninguno | Las gestiona la Store |
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

### ✅ Los dos canales COMPARTEN los datos (VERIFICADO 2026-07-20)

**No hay redirección de AppData.** Se comprobó registrando el MSIX con `winapp run` y observando dónde caían las escrituras:

- `%APPDATA%\com.maity.ai\meeting_minutes.sqlite-shm` y `onboarding-status.json` → **escritos por la instancia MSIX**
- `%LOCALAPPDATA%\Packages\Sixale.Maity_q5b9hqhck1xz0\` → la carpeta se crea, pero **queda sin datos de Maity**

La redirección de AppData era comportamiento del **Desktop Bridge viejo (Win10 1607–1809)**; Microsoft la eliminó para apps `Windows.FullTrustApplication`. Implicaciones:

- ✅ Migrar de descarga directa → Store **conserva** DB, modelos Whisper (~1.5 GB) y config. **NO hace falta escribir un importador de datos.**
- ⚠️ Pero ambos canales golpean la MISMA SQLite → ver reglas abajo.

### Reglas que impone el DB compartido

1. **Las migraciones deben ser ADITIVAS** mientras convivan los canales. La Store va días atrás (certificación), así que un release de GitHub puede migrar la DB hacia adelante y la versión vieja de la Store la abrirá "desde el futuro". Agregar tablas/columnas: OK. Renombrar o dropear algo que la versión vieja lee: **rompe**.
2. El crash `SQLx VersionMissing` ya está cubierto por `set_ignore_missing(true)` en `database/manager.rs` (v0.2.51) — pero eso NO te salva de un DROP.

### Auto-updater gateado (ya implementado)

Bajo MSIX el updater de GitHub instalaría una **segunda copia Win32** en paralelo a la de la Store. Gateado con:

- `src-tauri/src/utils.rs` → `is_running_under_package_identity()`. Usa `GetCurrentPackageFullName` con buffer nulo: `ERROR_INSUFFICIENT_BUFFER` (122) = proceso empaquetado; `APPMODEL_ERROR_NO_PACKAGE` (15700) = no.
- `src/services/updateService.ts` → invoca el comando y salta el check si es MSIX (cubierto en `updateService.test.ts`).

### Riesgo abierto: doble instalación

Un usuario puede terminar con NSIS **y** Store a la vez → dos entradas en el menú inicio, dos autostart, contención del micrófono y del sync queue sobre la misma DB. Además provoca el **error de DB por version-skew**: la versión más nueva (normalmente la que instaló después) migra la SQLite compartida hacia adelante y la versión más vieja — si es anterior a `set_ignore_missing(true)` (v0.2.51, `database/manager.rs`) — ya no puede abrirla y aborta con `migration <ts> was previously applied but is missing in the resolved migrations`.

- **Mitigación primaria (sin código):** en maity.cloud el botón principal apunta a la Store; el `.exe` de GitHub queda como link secundario ("instalación offline / empresas"). Si casi nadie instala ambas, el problema no existe.
- **✅ Mitigación en código — IMPLEMENTADA Y VERIFICADA (Store→quitar NSIS, jul-2026):** al arrancar bajo identidad de paquete (MSIX), Maity detecta la instalación NSIS rival y **exige** quitarla (diálogo forzado, sin opción de posponer). Solo se cubre esta dirección (la Store es siempre el canal sobreviviente). Piezas:
  - **Rust** `src-tauri/src/rival_install.rs` (dep `winreg`):
    - `get_rival_install()` — lee `HKCU`/`HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Maity`; solo devuelve `Some` si `is_running_under_package_identity()`.
    - `uninstall_rival()` — **NO corre el uninstaller in-process.** Escribe un orquestador `.cmd` a `%LOCALAPPDATA%\Maity\rival-cleanup.cmd` y lo lanza con `cmd.exe /c` **desacoplado del job MSIX** (`creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB)`). El `.cmd`: corre `uninstall.exe /S` → poll `reg query` hasta que la clave de desinstalación desaparezca → borra el autostart huérfano `Run\Maity` → **relanza la MSIX** por su AUMID (`GetCurrentApplicationUserModelId`, fallback `Sixale.Maity_q5b9hqhck1xz0!Maity`) vía `explorer.exe shell:AppsFolder\<AUMID>`. Loguea a `%LOCALAPPDATA%\Maity\logs\rival-cleanup.log`.
  - **⚠️ POR QUÉ el orquestador externo (gotcha clave):** el uninstaller NSIS hace `taskkill /im maity-desktop.exe` **por nombre de imagen** → cierra también la app MSIX que corre (mismo nombre de exe; **verificado empíricamente** que la mata aunque corra desde `Program Files\WindowsApps`). No se puede evitar el cierre → el orquestador debe sobrevivir al kill y reabrir la app. **NO combinar `DETACHED_PROCESS` con `CREATE_NO_WINDOW`** (flags de consola mutuamente excluyentes → CreateProcess deja el proceso inválido y el orquestador nunca ejecuta — bug real que costó una iteración). Se descartó `schtasks`/PowerShell `-ExecutionPolicy Bypass` (banderas rojas de persistence/security).
  - **Frontend** `src/components/rival-install/RivalInstallDialog.tsx` — pull-based (invoca `get_rival_install` al montar, solo Windows), modal shadcn **forzado** (sin botón "Más tarde", no descartable por X/Esc/click-fuera). Al confirmar: persiste flag `rival-install-just-removed.json` ANTES de invocar (sobrevive al kill) → toast de éxito al re-arrancar; además hace polling de `get_rival_install` como red por si la app no muriera. Montado en `layout.tsx` junto a `MeetingDetectionDialog`.
  - **Blindaje de doble-autostart:** `useAutostartBootstrap.ts` **salta** el registro de autostart bajo MSIX (evita un segundo `HKCU\...\Run\Maity`); el toggle de `PreferenceSettings.tsx` sale deshabilitado bajo MSIX. **Follow-up:** para dar "iniciar con el PC" a la versión Store haría falta un `<Extension Category="windows.startupTask">` en `Package.appxmanifest`.
- **⚠️ SIN VERIFICAR:** si el lock de single-instance de Tauri cruza el límite de identidad de paquete. Si NO cruza, ambas instancias corren simultáneas. Para probarlo hace falta una máquina con el NSIS instalado + el MSIX registrado.

### Certum/SimplySign: qué pasa si se deja caducar

- La **Store no se ve afectada** (firma Microsoft).
- Los binarios **ya publicados siguen confiables**: `src-tauri/scripts/sign-windows.ps1` firma con **sello de tiempo RFC 3161** (`/tr http://time.certum.pl /td SHA256`), y el timestamp congela la validez más allá del vencimiento del certificado.
- Solo los **builds nuevos** de descarga directa quedarían sin firmar → vuelve el SmartScreen.
- El **updater NO se rompe**: el `.sig` usa la llave **minisign de Tauri** (`TAURI_SIGNING_PRIVATE_KEY` / `pubkey` en `tauri.conf.json`), totalmente independiente de Certum.
- Los usuarios de descarga directa **NO migran solos** a la Store (identidad de paquete distinta) → mantener ambos canales hasta que la base se haya movido.

## Gotchas (aprendidos 2026-07-16)

- **⚠️ `winapp run` NO registra el staging tal cual** (descubierto 2026-07-20): construye una subcarpeta `<staging>\AppX\` con SOLO lo que el manifest declara (exe + `Assets\` + pri) y **descarta el payload suelto** (ffmpeg.exe, ffprobe.exe, llama-helper.exe, templates\). Síntoma: la app corre y transcribe, pero `recording_saver` truena en cada chunk con `Failed to spawn FFmpeg process: os error 2` (miles de errores) y el coach no arranca (sidecar ausente). **Fix: DESPUÉS de `winapp run`, copiar esos 4 elementos dentro de `<staging>\AppX\`** — funciona en caliente con la app corriendo (CreateProcess busca primero en el dir del exe; el incremental saver retiene el PCM en RAM y drena el backlog al aparecer ffmpeg, sin pérdida de audio). Verificar en logs (`%LOCALAPPDATA%\Maity\logs\`) que los `Saved checkpoint N` fluyan cada 30s sin errores.

- **NO hay redirección de AppData bajo MSIX** (verificado 2026-07-20) — la doc vieja del Desktop Bridge dice que sí; para `Windows.FullTrustApplication` **ya no aplica**. No diseñes migraciones de datos asumiendo aislamiento. Ver sección de convivencia de canales.
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
