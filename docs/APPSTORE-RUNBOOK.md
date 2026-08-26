# Runbook: publicar Maity en la Mac App Store

Estado de partida (24-ago-2026): la Mac se reinstalo. No hay toolchain, no hay
certificados, no hay `.env`, no hay `signing/`. La ultima subida fue **0.2.54**
(jul-2026, tras el rechazo 2.5.1 por `MobileDevice.framework`) y **NO fue aprobada**:
el motivo reportado fue **provisioning profile faltante** (ver 1.6 — el perfil del repo
esta atado a un certificado muerto). La siguiente subida es la **0.2.57** (misma
version que el MSIX de la Microsoft Store, commit `282415a`).

> **Consecuencia:** nadie ha comprobado nunca que Maity corra bajo sandbox en un build
> real de App Store. Los riesgos de la seccion final siguen TODOS abiertos. Por eso la
> Fase 5.5 (prueba local del `.pkg` firmado) no es opcional.

**Avance al 24-ago-2026 (tarde):** Fase 1 completa (los 4 certificados en el llavero,
respaldo en `signing/appstore/`), Fase 2 completa (toolchain + los 3 sidecars), Fase 4
completa (configs separadas, `Info.plist` limpio, updater gateado). Fase 5 tiene script
(`frontend/scripts/package-appstore.sh`). **Bloqueante unico: el provisioning profile
nuevo (1.6).**

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
      que usamos (sandbox, network client, **network server**, audio-input, user-selected
      files) no requieren capabilities especiales en el App ID.
- [ ] *Profiles* -> **+** -> **Mac App Store** -> App ID `com.maity.ai` -> selecciona el
      certificado **Apple Distribution** nuevo -> descarga.
- [ ] Deja el `.provisionprofile` en `~/Downloads` y avisame. Se incrusta como
      `Maity.app/Contents/embedded.provisionprofile` **antes** de firmar.

> El perfil viejo quedo invalido al cambiar de certificado. Hay que regenerarlo si o si.

> **Verificado 24-ago-2026 — esta fue la causa del rechazo de la 0.2.54.** Los dos
> perfiles del repo (`frontend/maityai.provisionprofile` y
> `frontend/src-tauri/embedded.provisionprofile`) son el MISMO perfil `maityai` del
> 23-mar-2026, atado al cert `0544FB2C7D06554BE285D837D96880A91781E0B7` ("3rd Party Mac
> Developer Application", llave perdida). Con el Apple Distribution nuevo
> (`26DAADE455FAEF651DC7605945301D8D51ED98DD`) ese perfil es papel mojado: para Apple es
> como si la app no llevara ninguno. **Re-descargar el perfil existente del portal NO
> sirve** (sigue atado al cert viejo) — hay que crear uno **nuevo** eligiendo el
> certificado nuevo. Tampoco se "instala" con doble clic (macOS lo confunde con un
> perfil de configuracion y falla): solo se incrusta en el `.app`, cosa que hace
> `package-appstore.sh`, que ademas **rechaza** cualquier perfil cuyo certificado no
> coincida con el de firma.
>
> Pasos en `developer.apple.com/account/resources/profiles/list`: **+** → Distribution →
> **Mac App Store Connect** → App ID `com.maity.ai` → certificado **Apple Distribution
> que vence en ago-2027** (el de mar-2027 es el muerto) → Generate → Download. Luego:
> `scripts/package-appstore.sh ~/Downloads/<perfil>.provisionprofile`.

---

## FASE 2 — Entorno de build  **[YO, ~40 min de descarga]**

- [ ] Homebrew *(pide tu contrasena de admin una vez)*
- [ ] Rust via rustup + targets `aarch64-apple-darwin` y `x86_64-apple-darwin`
      (el bundle es universal, hacen falta los dos)
- [ ] Node LTS + pnpm
- [ ] `cmake` (dep de whisper.cpp). **`ffmpeg` ya NO se instala con brew**: el pre-build
      lo compila desde la fuente oficial (`scripts/build-ffmpeg-macos.sh`, LGPL, universal)
      y lo mete al bundle como sidecar — ver riesgo 0, resuelto en #77.
- [ ] `pnpm install` en `frontend/`
- [ ] Compilar los **3 sidecars** de `llama-helper` (arm64, x86_64 y el universal con
      `lipo`) en `frontend/src-tauri/binaries/`. Faltando cualquiera, el bundling
      falla — ver `.claude/skills/build/SKILL.md` paso 0b. Los 3 de `ffmpeg` los deja
      solo el pre-build (`build-ffmpeg-macos.sh`; la primera vez tarda unos minutos).

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

**Completada (24-ago-2026).** Habia un conflicto que hacia imposible un build de App Store:

- [x] `tauri.conf.json` traia la config de App Store pero `tauri.macos.conf.json` la
      pisaba con `Developer ID Application` + `entitlements.plist` (Tauri mergea el
      archivo de plataforma encima del base). Resuelto en `edb7cee`: el canal directo
      vive en `tauri.macos.conf.json` y el de App Store en `tauri.appstore.conf.json`,
      que se aplica encima con `--config` (`pnpm run tauri:build:appstore`).
- [x] `signingIdentity` por **nombre** (`Apple Distribution: … (8YLD233TA2)`), no por
      hash: sobrevive a re-emisiones del certificado.
- [x] Updater: `createUpdaterArtifacts: false` en el perfil App Store y gate en runtime
      (`187b2c7`) — Apple no permite apps que se auto-actualicen (2.4.5(iv)).
- [x] `Info.plist` limpio: se quito el `LSApplicationCategoryType` duplicado y la clave
      de sandbox `com.apple.security.device.audio-input` (va en entitlements, no ahi).
- [x] El check del framework privado (rechazo **2.5.1**, commit `f7ddda1`) lo hace
      `package-appstore.sh` con `otool -L` sobre todo ejecutable del bundle y aborta si
      aparece `PrivateFrameworks`. **`strings` no sirve** — no lee load commands.

---

## FASE 5 — Build y empaquetado  **[YO]**

Dos comandos, desde `frontend/`:

```bash
pnpm run tauri:build:appstore                                   # ~1 h desde cero (universal = 2 arquitecturas)
scripts/package-appstore.sh ~/Downloads/<perfil>.provisionprofile
# -> frontend/dist-appstore/Maity-<version>.pkg
```

- [x] Build universal release firmado con **Apple Distribution** + `entitlements-appstore.plist`
      (`tauri.appstore.conf.json`, targets `["app"]`, sin artefactos de updater).
- [x] `scripts/package-appstore.sh` (nuevo — **Tauri no produce el `.pkg` de App Store**;
      el `Maity-0.2.30.pkg` del historial se hizo a mano). Hace, en orden:
      1. `otool -L` sobre cada ejecutable: aborta si enlaza `PrivateFrameworks` (2.5.1).
      2. Valida el perfil: plataforma OSX, team, vigencia, que NO sea de Development
         y que **contenga el SHA-1 del cert con el que firma** — un perfil de otro cert
         se rechaza aqui, no en revision.
      3. Lo incrusta en `Contents/embedded.provisionprofile`.
      4. Re-firma de adentro hacia afuera: sidecar `llama-helper` con
         `entitlements-appstore-inherit.plist` (**solo** `app-sandbox` + `inherit`,
         como exige Apple para helpers embebidos), dylibs/frameworks si los hay, y el
         `.app` con `entitlements-appstore.plist`. `--options runtime --timestamp`.
      5. `codesign --verify --deep --strict` + asserts de `app-sandbox` e
         `Identifier=com.maity.ai`.
      6. `productbuild --sign "3rd Party Mac Developer Installer"`.
      7. Si hay `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY_PATH` en el entorno, valida
         con `xcrun altool --validate-app` (Xcode esta instalado) e imprime el comando
         de subida. Sin ellos, Transporter — o `altool -u $APPLE_ID -p $APPLE_PASSWORD`
         (app-specific password) a mano, que es lo que se uso el 25-ago.
      - **Gotcha ITMS-91109 (25-ago-2026, rechazo real de la primera entrega 0.2.57):**
        todo archivo que entra al bundle desde una descarga (el perfil; un `ffmpeg`
        futuro) trae `com.apple.quarantine` y `cp`/`ditto` lo preservan; `productbuild`
        lo mete al payload como AppleDouble y Apple rechaza la entrega. El script hace
        `xattr -cr` sobre el bundle **antes** de firmar y aborta si queda alguno.
      - **Reintento de la misma version:** App Store Connect rechaza un segundo upload
        con el mismo `CFBundleVersion` (ITMS-90186). `BUILD_NUMBER=0.2.57.1` fuerza solo
        `CFBundleVersion`; `CFBundleShortVersionString` sigue siendo la del repo.
- [x] **Hecho el 25-ago-2026 para 0.2.57.** Perfil nuevo `maityai` (creado 25-ago, cert
      `26DAADE4…`) guardado como `frontend/src-tauri/embedded.provisionprofile` (el
      duplicado `frontend/maityai.provisionprofile` se elimino). Con Apple ID +
      app-specific password (`frontend/.env`), sin Transporter.app ni API key.
      - 1a entrega (UUID `572ed854…`): **rechazada por ITMS-91109** — el perfil llevaba
        `com.apple.quarantine` de la descarga. Ver gotcha abajo.
      - 2a entrega (UUID `4784c98b-50e6-4ab6-b3fe-f4e29aa1065c`): VERIFY + UPLOAD
        SUCCEEDED con el payload sin xattrs, mismo build 0.2.57 (ASC lo acepto sin
        `BUILD_NUMBER` porque la 1a nunca llego a registrarse como build).

---

## FASE 5.5 — Probar el build de Store bajo sandbox ANTES de subir  **[YO + TU]**

**No saltarse.** Un crash detectado aqui cuesta una tarde; el mismo crash en revision
cuesta 1-2 semanas por ciclo.

> ⚠️ **NO instalar el `.pkg` en la Mac de desarrollo.** Un `.app` firmado con Apple
> Distribution + perfil de Mac App Store **solo arranca instalado desde la Store o
> TestFlight**. Verificado el 25-ago-2026 con la 0.2.57: `open -a /Applications/Maity.app`
> → `RBSRequestErrorDomain Code=5 "Launch failed"` / `NSPOSIXErrorDomain Code=163`;
> `spctl -a -t exec` → `rejected`. Encima, `installer` deja `/Applications/Maity.app`
> como copia de **root** que pisa la app de trabajo (hay que `sudo rm -rf` y reinstalar
> el `.dmg`) y que ademas **secuestra el esquema `maity://`** en LaunchServices
> (issue #79).

Hay dos vias. La rapida sirve para casi todo; la fiel es la unica que corre
exactamente el binario que revisa Apple.

### Via rapida — copia sandbox re-firmada con Developer ID (`--sandbox-test`)

```bash
pnpm run tauri:build:appstore
scripts/package-appstore.sh --sandbox-test        # NO genera .pkg
open frontend/dist-appstore/Maity-sandbox-test.app
```

El script copia el `.app` de Store ya firmado, le quita `embedded.provisionprofile` y
los entitlements que exigen perfil (`application-identifier`, `team-identifier`), y lo
re-firma con **Developer ID** conservando `app-sandbox` y el resto (`network.server`,
`audio-input`…). Corre en `~/Library/Containers/com.maity.ai/` como el build real:
mismo sandbox, mismos permisos TCC, mismo `llama-helper`/`ffmpeg` heredando el sandbox.
Lo unico que NO reproduce es la instalacion como root en `/Applications` ni la
validacion del perfil (eso lo cubre TestFlight).

- [ ] Cerrar cualquier otra instancia de Maity (single-instance por bundle id) y abrir la copia
- [ ] Ejercitar cada camino que el sandbox puede romper:
  - [ ] **Login con Google** → `lsof -nP -iTCP:17823 -sTCP:LISTEN` lista `maity-desktop`
        y el log del contenedor trae `[AuthServer] Started on 127.0.0.1:17823` (#76,
        verificado el 26-ago-2026)
  - [ ] **Grabar ~30 s y parar** → en el log `Using bundled ffmpeg: …/Contents/MacOS/ffmpeg`
        y `audio.mp4` en la carpeta de la reunion **dentro del contenedor**; ni un
        `FFmpeg not found` (#77)
  - [ ] Captura de **audio del sistema** (ScreenCaptureKit + consentimiento TCC)
  - [ ] Transcripcion local (Parakeet / Whisper)
  - [ ] **Resumen con `llama-helper`** <- el mas probable de tronar, ver riesgo 1
  - [ ] Descarga de modelos en primer arranque
  - [ ] Deep link `maity://` con la app abierta: `open -a frontend/dist-appstore/Maity-sandbox-test.app "maity://auth/callback?error=access_denied"`
        (con `-a`: un `open` pelon lo enruta LaunchServices a `/Applications/Maity.app`)
  - [ ] **Permisos TCC tras cambio de certificado**: abrir sobre una version firmada
        con el cert VIEJO y confirmar que macOS NO vuelve a pedir microfono/grabacion de
        pantalla. Deberian conservarse porque el designated requirement se apoya en el
        Team ID (`8YLD233TA2`) y el bundle ID, y ninguno cambia — pero verificarlo, porque
        si se pierde, cada usuario tiene que re-conceder permisos tras actualizar.
- [ ] Revisar crashes de sandbox en Console.app filtrando por `sandboxd` y `com.maity.ai`
- Log del contenedor: `~/Library/Containers/com.maity.ai/Data/Library/Application Support/Maity/logs/maity.<fecha UTC>.log`

**Ruido esperado bajo sandbox (no son bugs de la app):**
- `ERROR tauri_plugin_single_instance … failed to listen to other processes - launching
  normally: Operation not permitted` — el plugin escucha en `/tmp/com.maity.ai_si.sock`
  y el sandbox veta `/tmp`. La app arranca igual; el deep link con la app ya abierta
  llega por el evento de URL de macOS, no por ese socket. Pendiente: issue aparte para
  silenciarlo bajo sandbox.

### Via fiel — TestFlight para Mac

Es el mismo `.pkg` que se sube a App Store Connect, instalado por Apple con su firma y
su perfil: lo que ve el revisor, sin excepciones.

1. Subir el build (Fase 6). Queda `processingState: VALID` en unos minutos.
2. **Cifrado de exportacion**: `Info.plist` ya declara `ITSAppUsesNonExemptEncryption=false`
   (solo TLS del sistema, exento) — sin esa clave cada build se atora en *Missing
   Compliance* y no se puede repartir hasta contestar el cuestionario a mano.
3. En App Store Connect → app → **TestFlight** → *Internal Testing* → **+** crear grupo
   (p. ej. "Maity core"), agregar testers (cuentas del team en ASC; hasta 100 internos,
   sin revision de Apple) y asignar el build. Por API (key `G384ZFBM29`, `frontend/.env`):
   `POST /v1/betaGroups` con `isInternalGroup: true`, `POST /v1/betaGroups/{id}/relationships/builds`.
4. En la Mac: instalar **TestFlight** desde la Mac App Store, aceptar la invitacion (correo
   del Apple ID del tester) e instalar Maity desde ahi. Se instala en `/Applications`
   **como usuario** (no root) y se actualiza sola con cada build nuevo.
5. Repetir la checklist de arriba. Si algo falla aqui y no en la copia sandbox, es del
   perfil/entitlements con identifier (riesgo 3), no del sandbox.

**Antes de TestFlight**: quitar la copia root si quedo de un `.pkg` anterior
(`sudo rm -rf /Applications/Maity.app`) — si no, TestFlight no puede instalar encima y
el `maity://` sigue secuestrado.

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

0. **`ffmpeg` — RESUELTO en #77 (25-ago-2026).** Hasta la 0.2.57 se descargaba en
   runtime (`audio/ffmpeg.rs` → `ffmpeg_sidecar`, evermeet.cx/osxexperts.net →
   `~/.local/bin`): bajo sandbox no se puede escribir, y ejecutar un binario descargado
   viola **2.5.2**. Sin `ffmpeg` no hay `audio.mp4` al terminar una grabacion — lo
   primero que prueba un revisor. Ahora `scripts/build-ffmpeg-macos.sh` (pre-build)
   compila desde la fuente oficial (SHA-256 pineado) un **ffmpeg minimo LGPL**
   (`--disable-gpl --disable-nonfree`, solo `f32le→aac/mp4` y `concat -c copy`; ~5 MB
   universal) y entra como **`bundle.externalBin`** (`tauri.macos.conf.json`) →
   `Contents/MacOS/ffmpeg`, que el paso 3a de `package-appstore.sh` firma con
   `entitlements-appstore-inherit.plist`. El script ademas exige que exista, sea
   universal y no lleve `--enable-gpl`. **No** usar `bundle.resources`: nada firma
   ejecutables en `Contents/Resources`. Los builds prehechos de terceros son GPL y no
   son distribuibles en la Store. Licencia: `docs/THIRD-PARTY-NOTICES.md` + aviso en
   Ajustes → Acerca de.
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
6. **Login social por servidor OAuth en localhost** (`auth_server.rs`, `bind` en
   `127.0.0.1:17823`). El sandbox distingue *conectar* (`network.client`) de *escuchar*
   (`network.server`): sin el segundo el `bind` se deniega incluso en loopback, el
   frontend cae al fallback `maity://auth/callback` y el login muere. **Resuelto en #76**
   (25-ago-2026): `entitlements-appstore.plist` ya trae `com.apple.security.network.server`
   y el fallback `maity://` ya entiende el `?code=` de PKCE. Si el entitlement desaparece
   de la firma, es lo primero que se rompe en un revisor. Diagnóstico: tras el clic en
   "Continuar con Google", `lsof -nP -iTCP:17823 -sTCP:LISTEN` debe listar el proceso.

Si la 0.2.54 quedo **aprobada** en julio, los puntos 1-3 ya estan resueltos y solo hay
que no romperlos. **Confirmar el estado de esa build en App Store Connect antes de
invertir en depurar sandbox.**

---

## Orden recomendado

Fase 1.2 (yo, ahora) -> 1.3 (tu, portal) -> 1.4 (yo) -> **Fase 2 corriendo en
paralelo mientras tu haces 1.5/1.6 y Fase 3** -> Fase 4 -> Fase 5 -> Fase 6.
