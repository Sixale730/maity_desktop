---
name: store-msix
description: Empaquetar Maity Desktop como MSIX y publicarlo en la Microsoft Store para quitar el warning de SmartScreen en Windows (empresa MX). Úsalo cuando el usuario quiera generar el .msix, probarlo localmente, o continuar el proceso de publicación en Partner Center.
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

### 2. Iconos reales (⚠️ PENDIENTE — hoy son placeholder)

`winapp init` genera iconos genéricos en `frontend/Assets/`. Reemplazarlos con el icono real de Maity (base en `frontend/src-tauri/icons/`). Se necesitan los logos escalados que referencia el manifest: `StoreLogo.png`, `MedTile.png` (Square150x150), `AppList.png` (Square44x44), `WideTile.png`.

### 3. Compilar con frontend EMBEBIDO (CRÍTICO)

**Usar `tauri build`, NO `cargo build` crudo.** Un `cargo build` debug apunta el webview a `localhost:3118` (dev server) → pantalla de error. `tauri build` embebe el frontend. `--no-bundle` salta los instaladores NSIS/MSI y la firma Certum (no la necesitamos para MSIX).

```powershell
$env:LIBCLANG_PATH='C:\Program Files\LLVM\bin'
pnpm -C frontend exec tauri build --debug --no-bundle     # prueba
# pnpm -C frontend exec tauri build --no-bundle           # producción (release)
```

El exe queda en **`C:\maity_desktop\target\debug\maity-desktop.exe`** (¡el `target` está en la RAÍZ del workspace, no en `src-tauri/`!). Nombre del exe = `maity-desktop.exe` (nombre del paquete Cargo).

### 4. Stagear el payload

Copiar a un folder de staging (junto al manifest):
- `maity-desktop.exe` + `llama-helper.exe` → de `target/release/` (o `target/debug/`).
- `ffmpeg.exe` + `ffprobe.exe` → **de `target/debug/`** (⚠️ el build release con `--no-bundle` NO copia ffmpeg al output; se necesitan para guardar grabaciones — encode PCM→AAC/MP4).
- `Package.appxmanifest`, `Assets/`, `templates/` (de `frontend/src-tauri/templates/`).
- **NO** hace falta `app_lib.dll` (el exe enlaza el lib estático) ni `WebView2Loader.dll` (Tauri 2 lo enlaza estático).

### 5. Probar local — validar audio (opcional pero recomendado)

```powershell
winapp run "<staging>" --detach --exe maity-desktop.exe
```
Registra identidad de paquete y lanza Maity. Probar: iniciar grabación, aceptar permiso de mic, poner audio sonando, confirmar que graba **mic + audio del sistema**, detener. Limpiar después:
```powershell
taskkill /F /IM maity-desktop.exe
Get-AppxPackage -Name Sixale.Maity | Remove-AppxPackage
```
✅ Validado 2026-07-16: el audio (incl. WASAPI loopback del sistema) funciona bajo el contenedor MSIX.

### 6. Generar el MSIX real

```powershell
winapp package "<staging>" --manifest "<staging>\Package.appxmanifest" --generate-cert
```
Genera `Sixale.Maity_<version>_x64.msix`. El cert de dev es solo para instalar local; **NO firmar con Certum** — Microsoft firma el MSIX al subirlo a la Store.

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

## Gotchas (aprendidos 2026-07-16)

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
