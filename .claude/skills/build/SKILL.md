---
name: build
description: Build firmado de Maity Desktop con bump de version, commit, tag y release en GitHub
user-invocable: true
disable-model-invocation: false
argument-hint: "[patch|minor|major]"
---

# Skill: Build firmado con bump de version y release en GitHub

Ejecuta un build firmado de Maity Desktop con bump automatico de version semver, crea commit, tag y publica release en GitHub con los artefactos.

El build incluye **dos tipos de firma**:
1. **Windows Code Signing (Certum)**: Firma el .exe e instaladores para que Windows muestre "Asertio" como publisher (no "Desconocido"). Requiere SimplySign Desktop conectado.
2. **Tauri Updater Signing (rsign)**: Firma los archivos .sig y latest.json para el auto-updater de la app. Usa `TAURI_SIGNING_PRIVATE_KEY` del `.env`.

## Instrucciones

### Paso 0: Verificar prerequisitos de firma

**ANTES de cualquier otra cosa**, verificar que el code signing este listo:

1. Verificar que SimplySign Desktop este conectado ejecutando:
   ```bash
   powershell -Command '& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe" sign /debug /fd SHA256 /v 2>&1' | grep -i "Asertio"
   ```
   - Si aparece `Issued to: Asertio` → SimplySign esta conectado, continuar.
   - Si NO aparece → **DETENER** y avisar al usuario: "SimplySign Desktop no esta conectado. Abre SimplySign Desktop, genera un token desde la app del celular, y conectate."

2. Informar al usuario: "SimplySign Desktop detectado. La sesion de firma dura ~2 horas."

### Paso 1: Leer version actual

Leer `frontend/src-tauri/tauri.conf.json` y extraer el campo `"version"`.

### Paso 2: Determinar tipo de bump

- Si `$ARGUMENTS` contiene `patch`, `minor`, o `major` → usar ese tipo directamente.
- Si `$ARGUMENTS` esta vacio o no coincide → preguntar al usuario con AskUserQuestion:
  - Opciones: `patch` (0.2.5 → 0.2.6), `minor` (0.2.5 → 0.3.0), `major` (0.2.5 → 1.0.0)

### Paso 3: Calcular nueva version

Aplicar bump semver a la version actual:
- `patch`: incrementar Z en X.Y.Z
- `minor`: incrementar Y, resetear Z a 0
- `major`: incrementar X, resetear Y y Z a 0

### Paso 4: Actualizar version en 3 archivos

Usar Edit tool para actualizar la version en:

1. **`frontend/src-tauri/tauri.conf.json`**: Cambiar `"version": "OLD"` → `"version": "NEW"`
2. **`frontend/package.json`**: Cambiar `"version": "OLD"` → `"version": "NEW"`
3. **`frontend/src-tauri/Cargo.toml`**: Cambiar `version = "OLD"` → `version = "NEW"`

### Paso 5: Cargar Tauri updater signing keys

1. Leer `frontend/.env` con Read tool
2. Extraer `TAURI_SIGNING_PRIVATE_KEY` (valor base64 completo, NO es ruta a archivo)
3. Extraer `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (valor directo)

**Nota**: Estas keys son para el updater de Tauri (firma de .sig/latest.json), NO para Windows code signing. El code signing de Windows lo maneja automaticamente `sign-windows.ps1` via SimplySign Desktop.

### Paso 6: Ejecutar build firmado

Ejecutar con Bash tool (timeout 600000ms = 10 minutos):

```bash
cd /c/maity_desktop/frontend && TAURI_SIGNING_PRIVATE_KEY="<valor_base64>" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>" pnpm run tauri:build
```

**IMPORTANTE**: En Windows/MINGW, usar la sintaxis de variables de entorno inline con el comando. La variable `TAURI_SIGNING_PRIVATE_KEY` debe contener el valor base64 completo tal como aparece en el `.env`.

Durante el build, Tauri llamara automaticamente a `scripts/sign-windows.ps1` para firmar cada binario con el certificado Certum "Asertio" (SHA1: `81DACE307F40CC0BB002FFB5B4785BFAB97DCF7F`). El script usa:
- `signtool.exe` version 10.0.26100.0 (requerida; la version 10.0.19041.0 tiene bugs con SimplySign)
- Timestamp server: `http://time.certum.pl` (RFC 3161)
- Algoritmo: SHA256

### Paso 7: Verificar resultado del build

**Si exit code != 0:**
- Mostrar el error completo
- Si el error es de signing (`SignTool Error`), sugerir: "Verifica que SimplySign Desktop siga conectado"
- **NO hacer commit**
- **NO crear release**
- **NO reportar como completado**
- Revertir los cambios de version en los 3 archivos si el usuario lo solicita
- **DETENER AQUI** — no continuar a los pasos siguientes

**Si exit code = 0:**
- Verificar que NO aparezca el warning "signing was skipped" en la salida
- Verificar que aparezcan lineas `Successfully signed` del script de Certum
- Continuar al Paso 8

### Paso 8: Verificar firma del instalador

Verificar que el instalador NSIS tenga la firma Certum correcta:

```bash
powershell -Command '& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe" verify /pa /v "C:\maity_desktop\target\release\bundle\nsis\Maity_X.Y.Z_x64-setup.exe" 2>&1' | grep -A2 "Issued to"
```

Debe mostrar `Issued to: Asertio` / `Issued by: Certum Code Signing 2021 CA`.

### Paso 9: Commit

Crear commit con los 3 archivos de version actualizados:

```bash
cd /c/maity_desktop && git add frontend/src-tauri/tauri.conf.json frontend/package.json frontend/src-tauri/Cargo.toml
```

```bash
cd /c/maity_desktop && git commit -m "$(cat <<'EOF'
chore: bump version to X.Y.Z

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

### Paso 10: Generar notas del release

1. Ejecutar `git log` desde el tag anterior hasta HEAD para obtener los commits incluidos
2. Crear un body en formato markdown con seccion `## Cambios` listando los cambios como bullet points
3. Cada bullet debe ser conciso y descriptivo, basado en los mensajes de commit
4. Preguntar al usuario con AskUserQuestion si quiere editar/ajustar las notas o si estan bien

### Paso 11: Crear release en GitHub con artefactos

Los artefactos del build se encuentran en:
- Instalador NSIS: `target/release/bundle/nsis/Maity_X.Y.Z_x64-setup.exe`
- Firma NSIS: `target/release/bundle/nsis/Maity_X.Y.Z_x64-setup.exe.sig`
- `latest.json`: `target/release/bundle/latest.json` (puede estar en `bundle/` o `bundle/nsis/`, buscar con Glob)

**CRITICO — Verificar `latest.json` antes de subir**:

1. Leer el contenido de `latest.json` con Read tool
2. Verificar que contenga:
   - `"version": "X.Y.Z"` (la version NUEVA, no la anterior)
   - `"url"` apuntando a `https://github.com/Sixale730/maity_desktop/releases/download/vX.Y.Z/Maity_X.Y.Z_x64-setup.exe`
   - `"signature"` con el contenido del archivo `.sig`
3. Si `latest.json` tiene la version anterior (Tauri a veces reutiliza el viejo), **regenerarlo manualmente** con Write tool usando este formato:

```json
{
  "version": "X.Y.Z",
  "notes": "DESCRIPCION_BREVE_DE_CAMBIOS",
  "pub_date": "YYYY-MM-DDTHH:MM:SSZ",
  "platforms": {
    "windows-x86_64": {
      "signature": "CONTENIDO_DEL_ARCHIVO_.sig",
      "url": "https://github.com/Sixale730/maity_desktop/releases/download/vX.Y.Z/Maity_X.Y.Z_x64-setup.exe"
    }
  }
}
```

Crear el release con `gh` (esto crea el tag automaticamente sin necesidad de push):

```bash
cd /c/maity_desktop && gh release create vX.Y.Z \
  "target/release/bundle/nsis/Maity_X.Y.Z_x64-setup.exe" \
  "target/release/bundle/nsis/Maity_X.Y.Z_x64-setup.exe.sig" \
  "target/release/bundle/latest.json" \
  --title "vX.Y.Z - TITULO" \
  --notes "BODY_MARKDOWN" \
  --latest
```

### Paso 12: Reportar resultado final

Mostrar resumen completo:
- Version: `vX.Y.Z`
- Commit local: hash corto
- Release URL: (link al release en GitHub)
- Artefactos subidos: listar archivos
- Code Signing: Certum "Asertio" (SHA1: 81DACE...)
- Updater Signing: rsign (Tauri updater)
- Estado: Build firmado + Commit local + Release publicado

### Notas

- El build tarda varios minutos. Usar timeout de 600000ms (10 min).
- El script `tauri-auto.js` auto-detecta GPU features.
- **Dos firmas**: El build aplica AMBAS firmas automaticamente:
  - Windows Code Signing (Certum via `sign-windows.ps1`) → para que Windows no diga "Desconocido"
  - Tauri Updater Signing (rsign via `TAURI_SIGNING_PRIVATE_KEY`) → para el auto-updater
- Si `TAURI_SIGNING_PRIVATE_KEY` no esta en el entorno, el build saldra con code 0 pero SIN firma de updater (solo warning). Este skill DEBE asegurar que la key este disponible.
- Si SimplySign Desktop no esta conectado, el build fallara en el paso de code signing.
- La sesion de SimplySign dura ~2 horas por token. Si el build falla por timeout de SimplySign, reconectar desde la app del celular.
- Para builds sin code signing (dev rapido): `SKIP_CODE_SIGNING=true pnpm run tauri:build`
- El updater de la app busca `latest.json` en `https://github.com/Sixale730/maity_desktop/releases/latest/download/latest.json`, por eso es critico que el release tenga el flag `--latest` y que `latest.json` este como asset.
- NO hacer git push. Solo commit local + release en GitHub.
- **Certificado Certum**: Expira Feb 19, 2027. SHA1: `81DACE307F40CC0BB002FFB5B4785BFAB97DCF7F`. Si se renueva el certificado, actualizar el SHA1 en `sign-windows.ps1` o via env var `CERTUM_SHA1`.
