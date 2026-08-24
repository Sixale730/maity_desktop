# Runbook: publicar Maity en la Mac App Store

Estado de partida (24-ago-2026): la Mac se reinstalo. No hay toolchain, no hay
certificados, no hay `.env`, no hay `signing/`. La ultima subida fue **0.2.54**
(jul-2026, tras el rechazo 2.5.1 por `MobileDevice.framework`) y **sigue sin estar
aprobada**. Version actual del repo: **0.2.56**.

> **Consecuencia:** nadie ha comprobado nunca que Maity corra bajo sandbox en un build
> real de App Store. Los riesgos de la seccion final siguen TODOS abiertos. Por eso la
> Fase 5.5 (prueba local del `.pkg` firmado) no es opcional.

Datos fijos:

| Dato | Valor |
|---|---|
| Team ID | `8YLD233TA2` |
| Bundle ID | `com.maity.ai` |
| Titular | Julio Alexis Gonzalez Villa |
| Entitlements App Store | `frontend/src-tauri/entitlements-appstore.plist` |
| Categoria | `public.app-category.productivity` |

Leyenda: **[TU]** solo lo puedes hacer tu (portal de Apple, llavero, Transporter).
**[YO]** lo hago yo desde la terminal.

---

## FASE 1 — Certificados (empieza aqui)

Las llaves privadas se generan **nuevas en esta Mac**. Perder los `.p12` viejos no
cuesta nada mas que rehacer el tramite. ~15 min.

### 1.1 Reglas de revocacion — leer antes de tocar el portal

| Certificado | Revocar? |
|---|---|
| Apple Distribution | Si, sin riesgo. La App Store re-firma los binarios. |
| Mac Installer Distribution | Si, sin riesgo. |
| **Developer ID Application / Installer** | **NO.** Gatekeeper consulta revocacion: romperia los `.dmg` que ya estan instalados en Macs de usuarios via GitHub Releases. |

Para Developer ID **no hace falta revocar**: Apple permite varios vigentes a la vez
(limite ~5 segun tipo). Crea uno nuevo y deja el viejo muerto. Solo si topaste el
limite revoca el mas antiguo.

### 1.1b Inventario en el portal (verificado 24-ago-2026)

La cuenta YA tiene certificados vigentes hasta 2027, pero **sin llave privada** tras el
formateo, asi que no sirven para firmar:

| Certificado | Vence | Veredicto |
|---|---|---|
| Mac App Distribution | 2027/03/23 | Muerto. Revocar SOLO si el portal bloquea por cupo. |
| Mac Installer Distribution | 2027/04/04 | Idem. |
| Developer ID Application (x2) | 2027/02/01 | **NO REVOCAR** — firmaron los `.dmg` ya instalados. |
| Developer ID Installer | 2027/02/01 | **NO REVOCAR**, misma razon. |
| Distribution / Development (All) | varias | De la app movil. No tocar. |
| Distribution Managed | 2027/04/12 | Xcode Cloud. No se puede usar manualmente. |
| `com.maity.app` Apple Push Services | 2027/03/19 | Otro bundle id (movil). Fuera de alcance. |

**Regla: intentar crear los nuevos SIN revocar.** Apple permite varios vivos del mismo
tipo y solo hay uno de cada. Revocar unicamente si el portal responde que se llego al
maximo, y solo los dos de App Store.

Antes de darlas por perdidas: buscar `.p12` en la Mac vieja, Time Machine o Google Drive.
Si aparecen los de Mac App Distribution + Mac Installer Distribution, se salta la Fase 1
entera. Maximo 5 minutos de busqueda — regenerar es gratis.

### 1.2 Generar los CSR  **[YO]**

Genero dos pares de llaves con openssl y sus CSR. Ventaja sobre el Asistente de
Certificados del llavero: la llave privada queda respaldada como archivo desde el
minuto cero, no dependemos de acordarnos de exportar el `.p12` despues.

Salida en `signing/appstore/` (gitignoreado por la regla `/signing/`).

### 1.3 Emitir en el portal  **[TU]**

`developer.apple.com/account/resources/certificates` -> boton **+**

Sube cada CSR y descarga el `.cer`:

- [ ] **Apple Distribution** <- CSR `maity_appstore_app.certSigningRequest`. Firma el `.app`.
- [ ] **Mac Installer Distribution** <- CSR `maity_appstore_installer.certSigningRequest`. Firma el `.pkg`.
      Sin esta, Transporter rechaza el paquete. En el llavero aparece con el nombre
      antiguo **"3rd Party Mac Developer Installer"** — es la misma, no te confundas.
- [ ] *(opcional, para revivir el canal DMG)* Developer ID Application + Developer ID Installer.

Guarda los `.cer` descargados en `~/Downloads` y avisame.

### 1.4 Instalar + generar los .p12  **[YO]**

Convierto cada `.cer` a `.pem`, lo emparejo con su llave privada, produzco el `.p12`
y lo importo al llavero. Verificacion final:

```
security find-identity -v -p codesigning
```

Deben aparecer `Apple Distribution: ... (8YLD233TA2)` y
`3rd Party Mac Developer Installer: ... (8YLD233TA2)`.

### 1.5 Respaldar  **[TU]**

- [ ] Copia los `.p12` de `signing/appstore/` a tu gestor de contrasenas (1Password/similar).
      **Este es el paso que fallo la vez pasada.** `signing/` esta gitignoreado: si
      vuelves a formatear sin copia externa, repites este runbook completo.
- [ ] Anota la contrasena de exportacion de los `.p12` junto con ellos.

### 1.6 App ID y provisioning profile  **[TU]**

- [ ] Verifica que el App ID `com.maity.ai` exista en *Identifiers*. Los entitlements
      que usamos (sandbox, network client, audio-input, user-selected files) no
      requieren capabilities especiales en el App ID.
- [ ] *Profiles* -> **+** -> **Mac App Store** -> App ID `com.maity.ai` -> selecciona el
      certificado **Apple Distribution** nuevo -> descarga.
- [ ] Deja el `.provisionprofile` en `~/Downloads` y avisame. Se incrusta como
      `Maity.app/Contents/embedded.provisionprofile` **antes** de firmar.

> El perfil viejo quedo invalido al cambiar de certificado. Hay que regenerarlo si o si.

---

## FASE 2 — Entorno de build  **[YO, ~40 min de descarga]**

- [ ] Homebrew *(pide tu contrasena de admin una vez)*
- [ ] Rust via rustup + targets `aarch64-apple-darwin` y `x86_64-apple-darwin`
      (el bundle es universal, hacen falta los dos)
- [ ] Node LTS + pnpm
- [ ] `cmake`, `ffmpeg` (deps de whisper.cpp y del pipeline de audio)
- [ ] `pnpm install` en `frontend/`
- [ ] Compilar los **3 sidecars** de `llama-helper` (arm64, x86_64 y el universal con
      `lipo`) en `frontend/src-tauri/binaries/`. Faltando cualquiera, el bundling
      falla — ver `.claude/skills/build/SKILL.md` paso 0b.

No requiere Xcode completo. Command Line Tools alcanza para compilar y firmar.

---

## FASE 3 — Secretos del repo  **[TU + YO]**

- [ ] Reconstruir `frontend/.env` con `APPLE_ID`, `APPLE_PASSWORD` (app-specific
      password, se genera en appleid.apple.com) y `APPLE_TEAM_ID=8YLD233TA2`.
      Solo hace falta para notarizacion del canal DMG, **no** para App Store.
- [ ] **API Key de App Store Connect**: App Store Connect -> Users and Access -> Keys ->
      generar. Descarga el `AuthKey_XXXX.p8` (una sola vez) y anota Key ID + Issuer ID.
      Alternativa: Apple ID + app-specific password en Transporter.
- [ ] **`TAURI_SIGNING_PRIVATE_KEY`** — **RESUELTO: no se perdio.** Es multiplataforma
      (una sola llave minisign para Windows/macOS/Linux). El pubkey embebido en
      `tauri.conf.json` decodifica a `minisign public key: 35A3FAE3F5A7F430`, que es
      exactamente el id de `signing/tauri-updater-key/maity.key.pub`. Sigue viva en la
      maquina Windows:
      - `C:\maity_desktop\frontend\.env` (variable `TAURI_SIGNING_PRIVATE_KEY`)
      - `C:\maity_desktop\signing\tauri-updater-key\maity.key`

      Copiar de ahi junto con `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Irrelevante para
      App Store; critica para GitHub Releases.

> El cert **Certum** NO cruza de plataforma: su llave privada vive en el HSM de Certum y
> se usa via SimplySign Desktop. Solo firma el `.exe` de Windows.

---

## FASE 4 — Arreglar la config del repo  **[YO]**

Hay un conflicto activo que hoy hace **imposible** un build de App Store:

- [ ] `tauri.conf.json` trae la config de App Store (entitlements-appstore +
      identidad `0544FB2C…`), pero `tauri.macos.conf.json` **la pisa** con
      `Developer ID Application` + `entitlements.plist`. Tauri mergea el archivo de
      plataforma encima del base, asi que **todo build de macOS sale hoy como
      distribucion directa**. Hay que separar los dos canales en configs distintas
      en vez de editar a mano en cada release.
- [ ] Reemplazar el `signingIdentity` hardcodeado (`0544FB2C7D06554BE285D837D96880A91781E0B7`)
      por el hash del certificado nuevo. Con el viejo, el build falla en seco.
- [ ] Desactivar el updater en el perfil App Store (`createUpdaterArtifacts: false` +
      plugin fuera). Apple no permite apps que se auto-actualicen, y bajo sandbox
      fallaria igual.
- [ ] Limpiar `Info.plist`: tiene `LSApplicationCategoryType` **duplicado** y una clave
      de sandbox (`com.apple.security.device.audio-input`) que no pinta ahi.
- [ ] Verificar que no reaparecio el link al framework privado que causo el rechazo
      **2.5.1** (commit `f7ddda1`): `otool -L <bin> | grep -i PrivateFrameworks` debe
      salir vacio. **`strings` no sirve** — no lee load commands del Mach-O.

---

## FASE 5 — Build y empaquetado  **[YO]**

- [ ] Build universal release firmado con **Apple Distribution** + `entitlements-appstore.plist`
- [ ] Incrustar el provisioning profile en `Maity.app/Contents/embedded.provisionprofile`
- [ ] Re-firmar de adentro hacia afuera: primero el sidecar `llama-helper`, luego el
      `.app`. El hijo hereda el sandbox y debe ir firmado con el mismo team.
- [ ] Generar el `.pkg`:
      ```
      productbuild --component "…/Maity.app" /Applications \
        --sign "3rd Party Mac Developer Installer: … (8YLD233TA2)" \
        Maity-0.2.56.pkg
      ```
      **Tauri no produce el `.pkg` de App Store.** En el repo nunca existio ese script
      (el `Maity-0.2.30.pkg` del historial se hizo a mano). Lo dejo scripteado.
- [ ] Verificar firma y sandbox: `codesign -dv --entitlements - Maity.app`

---

## FASE 5.5 — Probar el .pkg firmado ANTES de subir  **[YO + TU]**

**No saltarse.** La 0.2.54 nunca se aprobo, asi que el comportamiento bajo sandbox es
territorio inexplorado. Un crash detectado aqui cuesta una tarde; el mismo crash en
revision cuesta 1-2 semanas por ciclo.

- [ ] Instalar el `.pkg` en esta Mac (queda en `/Applications`, con sandbox real)
- [ ] Ejercitar cada camino que el sandbox puede romper:
  - [ ] Grabacion de microfono
  - [ ] Captura de **audio del sistema** (ScreenCaptureKit + consentimiento TCC)
  - [ ] Transcripcion local (Parakeet / Whisper)
  - [ ] **Resumen con `llama-helper`** <- el mas probable de tronar, ver riesgo 1
  - [ ] Descarga de modelos en primer arranque
  - [ ] Login y deep link `maity://`
  - [ ] **Permisos TCC tras cambio de certificado**: instalar sobre una version firmada
        con el cert VIEJO y confirmar que macOS NO vuelve a pedir microfono/grabacion de
        pantalla. Deberian conservarse porque el designated requirement se apoya en el
        Team ID (`8YLD233TA2`) y el bundle ID, y ninguno cambia — pero verificarlo, porque
        si se pierde, cada usuario tiene que re-conceder permisos tras actualizar.
- [ ] Revisar crashes de sandbox en Console.app filtrando por `sandboxd` y `com.maity.ai`

## FASE 6 — Subida y revision  **[TU]**

- [ ] Instalar **Transporter.app** desde la Mac App Store (gratis).
      *(No uses `xcrun altool`: viene con Xcode completo, que no esta instalado.)*
- [ ] En App Store Connect, crear/actualizar el registro de la app para `com.maity.ai`.
- [ ] Arrastrar el `.pkg` a Transporter -> **Verify** -> **Deliver**.
- [ ] Esperar el procesamiento (~10-30 min) hasta que la build aparezca en App Store Connect.
- [ ] Llenar ficha: descripcion, screenshots, categoria, **cuestionario de privacidad**
      (Maity graba audio y lo procesa — declararlo bien o es rechazo seguro).
- [ ] Notas para el revisor: explicar que la transcripcion es local, que los modelos se
      descargan en el primer arranque, y **dar credenciales de prueba** (la app tiene
      gate de sesion: sin login no graba, y un revisor sin cuenta no puede probar nada).
- [ ] **Enviar a revision.**

---

## Riesgos de sandbox — mirar antes de quemar el envio

La app hace cosas que el sandbox restringe. Esto es lo que puede rebotar:

1. **`entitlements-appstore.plist` no tiene `allow-jit` ni
   `allow-unsigned-executable-memory`**, que si estan en el `entitlements.plist` del
   canal directo. Los agrego ahi por algo — probablemente `llama-helper` / ONNX
   Runtime. Si el sidecar los necesita, bajo App Store **crashea al generar resumenes**.
   Hay que probarlo con el build firmado antes de subir, no despues.
2. **Captura de audio del sistema (ScreenCaptureKit)** bajo sandbox depende de consentimiento
   TCC, no de un entitlement. El `entitlements.plist` directo declara
   `com.apple.security.device.screen-capture`; el de App Store no. Verificar si hace falta.
3. **Spawn del sidecar `llama-helper`**: proceso hijo hereda el sandbox; debe ir firmado
   con el mismo team y estar dentro del bundle.
4. **Descarga de ~1.6-3 GB de modelos en runtime** — permitido, pero Apple a veces lo
   cuestiona bajo guideline 2.4.5 / 3.2.2. Documentarlo en las notas del revisor.
5. **Updater de Tauri activo** = rechazo bajo 2.4.5(iv). Se desactiva en Fase 4.

Si la 0.2.54 quedo **aprobada** en julio, los puntos 1-3 ya estan resueltos y solo hay
que no romperlos. **Confirmar el estado de esa build en App Store Connect antes de
invertir en depurar sandbox.**

---

## Orden recomendado

Fase 1.2 (yo, ahora) -> 1.3 (tu, portal) -> 1.4 (yo) -> **Fase 2 corriendo en
paralelo mientras tu haces 1.5/1.6 y Fase 3** -> Fase 4 -> Fase 5 -> Fase 6.
