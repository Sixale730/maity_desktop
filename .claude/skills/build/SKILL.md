---
name: build
description: Build firmado de Maity Desktop con bump de version automatico
user-invocable: true
disable-model-invocation: true
argument-hint: "[patch|minor|major]"
---

# Skill: Build firmado con bump de version

Ejecuta un build firmado de Maity Desktop con bump automatico de version semver.

## Instrucciones

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

### Paso 5: Cargar signing keys

1. Leer `frontend/.env` con Read tool
2. Extraer `TAURI_SIGNING_PRIVATE_KEY` (es una ruta a un archivo .key)
3. Extraer `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (valor directo)

### Paso 6: Ejecutar build firmado

Ejecutar con Bash tool (timeout 600000ms = 10 minutos):

```bash
cd /c/maity_desktop/frontend && TAURI_SIGNING_PRIVATE_KEY="<ruta_del_key>" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>" pnpm run tauri:build
```

**IMPORTANTE**: En Windows/MINGW, usar la sintaxis de variables de entorno inline con el comando. La variable `TAURI_SIGNING_PRIVATE_KEY` debe contener la RUTA al archivo key tal como aparece en el `.env`.

### Paso 7: Reportar resultado

**Si exit code = 0:**
- Mostrar: "Build firmado completado: vX.Y.Z"
- Mostrar ruta de artefactos: `target/release/bundle/`
- Verificar que NO aparezca el warning "signing was skipped" en la salida
- Listar los 3 archivos modificados con la nueva version

**Si exit code != 0:**
- Mostrar el error completo
- **NO hacer commit**
- **NO reportar como completado**
- Revertir los cambios de version en los 3 archivos si el usuario lo solicita

### Notas

- El build tarda varios minutos. Usar timeout de 600000ms (10 min).
- El script `tauri-auto.js` auto-detecta GPU features.
- Si `TAURI_SIGNING_PRIVATE_KEY` no esta en el entorno, el build saldra con code 0 pero SIN firma (solo warning). Este skill DEBE asegurar que la key este disponible.
- NO hacer commit automaticamente despues del build. Solo informar el resultado.
