---
name: build
description: Build firmado de Maity Desktop con bump de version, commit, tag y release en GitHub
user-invocable: true
disable-model-invocation: false
argument-hint: "[patch|minor|major]"
---

# Skill: Build firmado con bump de version y release en GitHub

Ejecuta un build firmado de Maity Desktop con bump automatico de version semver, crea commit, tag y publica release en GitHub con los artefactos.

El build se adapta automaticamente a la plataforma actual:
- **macOS**: Firma con Developer ID + notarizacion Apple + .dmg
- **Windows**: Code Signing Certum + Tauri Updater Signing + .exe

## Instrucciones

> **Nota**: `pnpm run tauri:build` ahora encadena automaticamente un pre-check de lint
> (`scripts/lint-state-access.sh`) antes del build. Si el lint falla, el build aborta
> antes de quemar la firma de Certum. Para `pnpm run tauri:build:debug` ademas se
> ejecuta un smoke test post-build que valida que el binario arranque sin panics.
>
> Si necesitas saltar los checks (raro), usa `pnpm run tauri:build:skip-checks`.

### Paso 0: Detectar plataforma

Ejecutar `uname -s` para determinar la plataforma:
- `Darwin` → **macOS** (seguir pasos macOS)
- `MINGW*` / `MSYS*` / Windows → **Windows** (seguir pasos Windows)

### Paso 0b: Verificar prerequisitos de firma

**En Windows:**
1. Verificar que SimplySign Desktop este conectado ejecutando:
   ```bash
   powershell -Command '& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe" sign /debug /fd SHA256 /v 2>&1' | grep -i "Asertio"
   ```
   - Si aparece `Issued to: Asertio` → continuar.
   - Si NO → **DETENER** y avisar: "SimplySign Desktop no esta conectado."

2. Verificar que `frontend/.env` tenga `TAURI_SIGNING_PRIVATE_KEY` con valor (no vacio).

**En macOS:**
1. Verificar identidad de firma:
   ```bash
   security find-identity -v -p codesigning | grep "Developer ID Application"
   ```
   - Debe mostrar `Developer ID Application: Julio Alexis Gonzalez Villa (8YLD233TA2)`.

2. Verificar credenciales de notarizacion en `frontend/.env`:
   - `APPLE_ID` (no vacio)
   - `APPLE_PASSWORD` (no vacio)
   - `APPLE_TEAM_ID` (no vacio)

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

### Paso 5: Cargar credenciales de firma

Leer `frontend/.env` con Read tool y extraer las variables segun plataforma:

**Windows:**
- `TAURI_SIGNING_PRIVATE_KEY` (valor base64 completo)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

**macOS:**
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

### Paso 6: Ejecutar build firmado

**En macOS:**
```bash
cd "<repo>/frontend" && \
  APPLE_ID="<valor>" \
  APPLE_PASSWORD="<valor>" \
  APPLE_TEAM_ID="<valor>" \
  pnpm run tauri:build -- --target universal-apple-darwin
```

> **`--target universal-apple-darwin`** produce un `.dmg` que instala en Intel y Apple Silicon (un solo artefacto). Requiere ambos toolchains: `rustup target add aarch64-apple-darwin x86_64-apple-darwin` (una vez por máquina). Tarda ~2x que un build single-arch.

**En Windows:**
```bash
cd /c/maity_desktop/frontend && \
  TAURI_SIGNING_PRIVATE_KEY="<valor_base64>" \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>" \
  pnpm run tauri:build
```

**IMPORTANTE**: Timeout de 600000ms (10 minutos). El script `tauri-auto.js` auto-detecta GPU features.

### Paso 7: Verificar resultado del build

**Si exit code != 0:**
- Mostrar el error completo
- **NO hacer commit, NO crear release, NO reportar como completado**
- Revertir cambios de version si el usuario lo solicita
- **DETENER AQUI**

**Si exit code = 0, verificar segun plataforma:**

**En macOS:**
- Verificar que exista `target/universal-apple-darwin/release/bundle/dmg/Maity_X.Y.Z_universal.dmg`
- Verificar arquitecturas con `lipo -info target/universal-apple-darwin/release/bundle/macos/Maity.app/Contents/MacOS/Maity` → debe mostrar `x86_64 arm64`
- Si aparecio `Warn skipping app notarization` → advertir al usuario que el .dmg no fue notarizado (credenciales incorrectas o faltantes en `.env`)
- Si aparecio notarizacion exitosa → continuar normalmente

**En Windows:**
- Verificar que NO aparezca "signing was skipped"
- Verificar que aparezcan lineas `Successfully signed` del script Certum
- Continuar al paso 8

### Paso 8: Verificaciones post-build por plataforma

**En Windows — Verificar firma Certum:**
```bash
powershell -Command '& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe" verify /pa /v "C:\maity_desktop\target\release\bundle\nsis\Maity_X.Y.Z_x64-setup.exe" 2>&1' | grep -A2 "Issued to"
```
Debe mostrar `Issued to: Asertio` / `Issued by: Certum Code Signing 2021 CA`.

**En Windows — Regenerar updater signature post-firma Certum:**

La firma Certum modifica el binario, por lo que el `.sig` ya no coincide. **SIEMPRE** regenerar:

```bash
cd /c/maity_desktop/frontend && source <(grep -E '^TAURI_SIGNING' .env) && npx @tauri-apps/cli signer sign \
  -k "$TAURI_SIGNING_PRIVATE_KEY" -p "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
  "../target/release/bundle/nsis/Maity_X.Y.Z_x64-setup.exe"
```

Despues, actualizar `latest.json` con la nueva signature:
1. Leer el nuevo contenido del `.sig` generado
2. Editar `target/release/bundle/latest.json` reemplazando el campo `"signature"` con el nuevo valor

**En macOS**: No se requieren pasos adicionales post-build.

### Paso 9: Commit

Crear commit con los 3 archivos de version actualizados:

```bash
cd "<repo>" && git add frontend/src-tauri/tauri.conf.json frontend/package.json frontend/src-tauri/Cargo.toml
```

```bash
cd "<repo>" && git commit -m "$(cat <<'EOF'
chore: bump version to X.Y.Z

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

### Paso 10: Generar notas del release

1. Ejecutar `git log` desde el tag anterior hasta HEAD para obtener los commits incluidos
2. Crear un body en formato markdown con seccion `## Cambios` listando los cambios como bullet points
3. Cada bullet debe ser conciso y descriptivo
4. Preguntar al usuario con AskUserQuestion si quiere editar/ajustar las notas

### Paso 11: Crear o actualizar release en GitHub

**Verificar si el release ya existe:**
```bash
gh release view vX.Y.Z --repo Sixale730/maity_desktop 2>&1
```

**Si el release YA EXISTE** (ej: subir .dmg a release que ya tiene .exe):
```bash
gh release upload vX.Y.Z "<artefacto1>" "<artefacto2>" --repo Sixale730/maity_desktop
```

**Si el release NO EXISTE — crear nuevo:**

**Artefactos macOS:**
- `target/universal-apple-darwin/release/bundle/dmg/Maity_X.Y.Z_universal.dmg`
- `target/universal-apple-darwin/release/bundle/macos/Maity.app.tar.gz` (para updater)
- `target/universal-apple-darwin/release/bundle/macos/Maity.app.tar.gz.sig` (firma updater)

**Artefactos Windows:**
- `target/release/bundle/nsis/Maity_X.Y.Z_x64-setup.exe`
- `target/release/bundle/nsis/Maity_X.Y.Z_x64-setup.exe.sig`
- `target/release/bundle/latest.json`

**CRITICO para Windows — Verificar `latest.json` antes de subir:**

1. Leer el contenido de `latest.json` con Read tool
2. Verificar que contenga:
   - `"version": "X.Y.Z"` (version NUEVA)
   - `"url"` apuntando a `https://github.com/Sixale730/maity_desktop/releases/download/vX.Y.Z/Maity_X.Y.Z_x64-setup.exe`
   - `"signature"` con el contenido del archivo `.sig`
3. Si tiene la version anterior, regenerarlo manualmente con Write tool:

```json
{
  "version": "X.Y.Z",
  "notes": "DESCRIPCION_BREVE",
  "pub_date": "YYYY-MM-DDTHH:MM:SSZ",
  "platforms": {
    "windows-x86_64": {
      "signature": "CONTENIDO_DEL_.sig",
      "url": "https://github.com/Sixale730/maity_desktop/releases/download/vX.Y.Z/Maity_X.Y.Z_x64-setup.exe"
    }
  }
}
```

Crear release:
```bash
cd "<repo>" && gh release create vX.Y.Z \
  <artefactos...> \
  --title "vX.Y.Z - TITULO" \
  --notes "BODY_MARKDOWN" \
  --latest
```

### Paso 12: Reportar resultado final

Mostrar resumen completo:
- Version: `vX.Y.Z`
- Plataforma: macOS / Windows
- Commit local: hash corto
- Release URL: (link al release en GitHub)
- Artefactos subidos: listar archivos
- Firma: Developer ID + Notarizacion Apple (macOS) / Certum "Asertio" + rsign updater (Windows)
- Estado: Build firmado + Commit local + Release publicado

### Notas

- El build tarda varios minutos. Usar timeout de 600000ms (10 min).
- El script `tauri-auto.js` auto-detecta GPU features por plataforma.
- **macOS**: Firma con Developer ID Application (certificado local en Keychain) + notarizacion Apple (requiere APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID en `.env`).
- **Windows**: Dos firmas — Certum Code Signing (via `sign-windows.ps1` + SimplySign Desktop) + Tauri Updater Signing (rsign via `TAURI_SIGNING_PRIVATE_KEY`).
- Si `TAURI_SIGNING_PRIVATE_KEY` no esta en el entorno, el build saldra con code 0 pero SIN firma de updater (solo warning). Este skill DEBE asegurar que la key este disponible cuando se requiera updater.
- Si SimplySign Desktop no esta conectado (Windows), el build fallara en el paso de code signing.
- La sesion de SimplySign dura ~2 horas por token. Si el build falla por timeout, reconectar desde la app del celular.
- Para builds sin code signing (dev rapido en Windows): `SKIP_CODE_SIGNING=true pnpm run tauri:build`
- **Smoke test de auto-update (opcional pre-release)**: para detectar regresiones runtime que el test de estructura (`src/app/layout.test.ts`) no atrapa, antes de bumpear y publicar verifica que la version publicada **anterior** (instalada en una maquina/VM con sesion Supabase fresca) muestra el toast de actualizacion al abrir la app. El bug historico (commit `230b807`, 2026-02-02) sobrevivio 3 meses y 2 fixes fallidos porque nadie probaba en maquina con login lento. El test de estructura previene la regresion conocida; este smoke cubre fallos del plugin updater o del Sonner toast.
- NO hacer git push. Solo commit local + release en GitHub.
- Si el release ya existe con artefactos de otra plataforma, usar `gh release upload` para agregar los de la plataforma actual.
- El updater busca `latest.json` en `https://github.com/Sixale730/maity_desktop/releases/latest/download/latest.json`. Critico que el release tenga `--latest` y que `latest.json` sea asset.
- **Certificado Certum (Windows)**: Expira Feb 19, 2027. SHA1: `81DACE307F40CC0BB002FFB5B4785BFAB97DCF7F`.
- **Certificado Apple (macOS)**: Developer ID Application: Julio Alexis Gonzalez Villa (8YLD233TA2).
