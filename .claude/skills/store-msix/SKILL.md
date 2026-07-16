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
- `maity-desktop.exe`, `app_lib.dll`, `ffmpeg.exe`, `ffplay.exe`, `ffprobe.exe`, `llama-helper.exe` (todos de `target/debug/`)
- `Package.appxmanifest`, `Assets/`, `templates/` (de `frontend/src-tauri/templates/`)
- **NO** hace falta `WebView2Loader.dll` (Tauri 2 lo enlaza estático).

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

### 7. Subir a la Store

En Partner Center → producto **Maity** → submission en draft:
1. **Packages** → subir el `.msix`.
2. **Pricing and availability** (gratis / mercados).
3. **Properties** → categoría + **política de privacidad** (OBLIGATORIA porque graba audio).
4. **Age ratings** (cuestionario).
5. **Store listings** (descripción + capturas).
6. Justificar la capability **`runFullTrust`** donde lo pida.
7. **Submit for certification** (Microsoft escanea malware + revisa).

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
