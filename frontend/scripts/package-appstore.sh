#!/usr/bin/env bash
# Empaqueta Maity.app como .pkg firmado para la Mac App Store.
#
# Tauri NO produce el .pkg de App Store: solo deja el .app firmado con
# Apple Distribution (tauri.appstore.conf.json). Este script hace el resto:
#
#   1. Verifica que el .app exista y no enlace frameworks privados (rechazo 2.5.1).
#   2. Verifica que el provisioning profile sea de Mac App Store, vigente y que
#      contenga el MISMO certificado con el que vamos a firmar (un perfil atado
#      a un cert viejo = "falta el provisioning profile" en revision).
#   3. Incrusta el perfil en Contents/embedded.provisionprofile.
#   4. Re-firma de adentro hacia afuera: sidecar llama-helper (app-sandbox +
#      inherit), dylibs/frameworks si los hay, y por ultimo el .app con
#      entitlements-appstore.plist.
#   5. productbuild --sign "3rd Party Mac Developer Installer" -> dist-appstore/Maity-<ver>.pkg
#   6. Si hay API key de App Store Connect en el entorno, valida con altool.
#
# Uso:
#   scripts/package-appstore.sh [perfil.provisionprofile]
#     (default: src-tauri/embedded.provisionprofile)
#   scripts/package-appstore.sh --sandbox-test [perfil.provisionprofile]
#     Ademas del .app de Store, genera dist-appstore/Maity-sandbox-test.app: la misma
#     app re-firmada con Developer ID, SIN perfil y SIN application-identifier /
#     team-identifier, pero con app-sandbox. Es la unica forma de correr el build de
#     Store en esta Mac (un .app Apple Distribution no arranca fuera de la Store /
#     TestFlight — RBSRequestErrorDomain Code=5, issue #79). NO genera .pkg.
#
# Requiere antes:  pnpm run tauri:build:appstore
# Validacion opcional por terminal (si no, usar Transporter.app):
#   ASC_KEY_ID=XXXX ASC_ISSUER_ID=uuid ASC_KEY_PATH=~/Downloads/AuthKey_XXXX.p8 scripts/package-appstore.sh
# Reintento de la misma version (altool: ITMS-90186 Redundant Binary Upload):
#   BUILD_NUMBER=0.2.57.1 scripts/package-appstore.sh   # solo cambia CFBundleVersion
# Subida con Apple ID + app-specific password (sin API key), desde frontend/:
#   set -a; . ./.env; set +a
#   xcrun altool --validate-app -f dist-appstore/Maity-<ver>.pkg -t macos -u "$APPLE_ID" -p "$APPLE_PASSWORD"
#   xcrun altool --upload-app   -f dist-appstore/Maity-<ver>.pkg -t macos -u "$APPLE_ID" -p "$APPLE_PASSWORD"
set -euo pipefail

FRONTEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$FRONTEND_DIR/src-tauri"
# El target dir es el del WORKSPACE (raiz del repo), no src-tauri/target. Se lo
# preguntamos a cargo para no hardcodearlo.
TARGET_DIR="$(cd "$TAURI_DIR" && cargo metadata --format-version 1 --no-deps 2>/dev/null \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).target_directory")"
APP_SRC="$TARGET_DIR/universal-apple-darwin/release/bundle/macos/Maity.app"
OUT_DIR="$FRONTEND_DIR/dist-appstore"
APP="$OUT_DIR/Maity.app"

TEAM_ID="8YLD233TA2"
BUNDLE_ID="com.maity.ai"
APP_IDENTITY="Apple Distribution: Julio Alexis Gonzalez Villa ($TEAM_ID)"
PKG_IDENTITY="3rd Party Mac Developer Installer: Julio Alexis Gonzalez Villa ($TEAM_ID)"
ENTITLEMENTS="$TAURI_DIR/entitlements-appstore.plist"
ENTITLEMENTS_INHERIT="$TAURI_DIR/entitlements-appstore-inherit.plist"

SANDBOX_TEST=0
if [[ "${1:-}" == "--sandbox-test" ]]; then
  SANDBOX_TEST=1
  shift
fi
PROFILE="${1:-$TAURI_DIR/embedded.provisionprofile}"
# Identidad del canal directo, para la copia de prueba sandbox (misma que usa Tauri
# para el .dmg). Se lee de la config para no duplicar el literal.
DEV_ID_IDENTITY="$(node -p "require('$TAURI_DIR/tauri.macos.conf.json').bundle.macOS.signingIdentity")"

VERSION="$(node -p "require('$TAURI_DIR/tauri.conf.json').version")"
PKG="$OUT_DIR/Maity-$VERSION.pkg"

log()  { printf '\033[1;34m[pkg]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[pkg] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 0. prereqs
[[ "$(uname)" == "Darwin" ]] || fail "solo corre en macOS"
[[ -d "$APP_SRC" ]] || fail "no existe $APP_SRC — corre primero: pnpm run tauri:build:appstore"
[[ -f "$ENTITLEMENTS" ]] || fail "falta $ENTITLEMENTS"
[[ -f "$ENTITLEMENTS_INHERIT" ]] || fail "falta $ENTITLEMENTS_INHERIT"
[[ -f "$PROFILE" ]] || fail "no existe el provisioning profile: $PROFILE
  Genera uno nuevo en developer.apple.com -> Profiles -> + -> Mac App Store Connect
  -> App ID $BUNDLE_ID -> certificado Apple Distribution VIGENTE, y pasa la ruta como argumento."

security find-identity -v -p codesigning | grep -Fq "$APP_IDENTITY" \
  || fail "no esta en el llavero: $APP_IDENTITY"
security find-identity -v | grep -Fq "$PKG_IDENTITY" \
  || fail "no esta en el llavero: $PKG_IDENTITY (firma el .pkg; sin ella Transporter rechaza)"
if (( SANDBOX_TEST )); then
  security find-identity -v -p codesigning | grep -Fq "$DEV_ID_IDENTITY" \
    || fail "no esta en el llavero: $DEV_ID_IDENTITY (necesaria para --sandbox-test)"
fi

# SHA-1 del cert Apple Distribution que vamos a usar (lo que lista find-identity).
APP_CERT_SHA1="$(security find-identity -v -p codesigning \
  | grep -F "$APP_IDENTITY" | awk '{print $2}' | head -1)"
[[ -n "$APP_CERT_SHA1" ]] || fail "no pude leer el SHA-1 del certificado de firma"

# ------------------------------------------------- 1. copia limpia a staging
log "version $VERSION — staging en $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
# ditto (no cp -R: rompe symlinks de frameworks). --noextattr --noqtn descarta los
# xattrs de origen, incluidos los protegidos por SIP (com.apple.macl) que `xattr -c`
# NO puede borrar. Ver 2b.
ditto --noextattr --noqtn "$APP_SRC" "$APP"

MAIN_BIN="$APP/Contents/MacOS/maity-desktop"
[[ -x "$MAIN_BIN" ]] || fail "no encuentro el binario principal $MAIN_BIN"

# Rechazo 2.5.1 (commit f7ddda1): `strings` no sirve, hay que leer load commands.
while IFS= read -r bin; do
  if otool -L "$bin" | grep -qi 'PrivateFrameworks'; then
    otool -L "$bin" | grep -i 'PrivateFrameworks' >&2
    fail "$bin enlaza un framework privado de Apple — rechazo 2.5.1 garantizado"
  fi
done < <(find "$APP/Contents/MacOS" -type f -perm -u+x)
log "OK: ningun binario enlaza PrivateFrameworks"

# ffmpeg bundleado (#77): sidecar universal compilado LGPL por build-ffmpeg-macos.sh
# (externalBin de tauri.macos.conf.json). Sin el, bajo sandbox no se genera audio.mp4
# y la descarga en runtime viola 2.5.2. Se inspecciona SIN ejecutarlo (todavia lleva
# la firma Apple Distribution de Tauri, que no corre fuera de la Store): la linea de
# `configure` va embebida en el binario, asi que `grep -a` alcanza.
FFMPEG_BIN="$APP/Contents/MacOS/ffmpeg"
[[ -x "$FFMPEG_BIN" ]] || fail "falta $FFMPEG_BIN — el bundle debe traer ffmpeg.
  Corre scripts/build-ffmpeg-macos.sh y revisa bundle.externalBin en tauri.macos.conf.json."
FFMPEG_ARCHS="$(lipo -archs "$FFMPEG_BIN")"
[[ "$FFMPEG_ARCHS" == *x86_64* && "$FFMPEG_ARCHS" == *arm64* ]] \
  || fail "$FFMPEG_BIN no es universal (archs: $FFMPEG_ARCHS)"
grep -aq -- '--disable-gpl' "$FFMPEG_BIN" || fail "ffmpeg no fue compilado con --disable-gpl"
if grep -aqE -- '--enable-(gpl|nonfree)' "$FFMPEG_BIN"; then
  fail "ffmpeg reporta --enable-gpl/--enable-nonfree: no distribuible en App Store"
fi
log "OK: ffmpeg bundleado, universal ($FFMPEG_ARCHS) y LGPL"

# ------------------------------------------ 2. validar el provisioning profile
PP_PLIST="$(mktemp -t maity-pp).plist"
security cms -D -i "$PROFILE" > "$PP_PLIST" 2>/dev/null \
  || fail "no pude decodificar $PROFILE (¿es un .provisionprofile valido?)"

PP_NAME="$(plutil -extract Name raw "$PP_PLIST")"
PP_EXP="$(plutil -extract ExpirationDate raw "$PP_PLIST")"
PP_PLATFORM="$(plutil -extract Platform json -o - "$PP_PLIST")"
PP_APPID="$(plutil -extract Entitlements.com.apple.application-identifier raw "$PP_PLIST" 2>/dev/null || true)"
PP_TEAM="$(plutil -extract TeamIdentifier.0 raw "$PP_PLIST" 2>/dev/null || true)"

[[ "$PP_PLATFORM" == *OSX* ]] || fail "el perfil '$PP_NAME' no es de macOS (Platform=$PP_PLATFORM)"
[[ "$PP_TEAM" == "$TEAM_ID" ]] || fail "el perfil '$PP_NAME' es del team '$PP_TEAM', no de $TEAM_ID"
if [[ -n "$PP_APPID" && "$PP_APPID" != "$TEAM_ID.$BUNDLE_ID" && "$PP_APPID" != "$TEAM_ID.*" ]]; then
  fail "el perfil '$PP_NAME' es para '$PP_APPID', no para $TEAM_ID.$BUNDLE_ID"
fi
# Perfiles de App Store no traen ProvisionedDevices; si los trae es de Development.
if plutil -extract ProvisionedDevices raw "$PP_PLIST" >/dev/null 2>&1; then
  fail "el perfil '$PP_NAME' es de DEVELOPMENT (trae ProvisionedDevices). Se necesita uno de Mac App Store Connect."
fi
PP_EXP_EPOCH="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$PP_EXP" '+%s')"
(( PP_EXP_EPOCH > $(date -u '+%s') )) || fail "el perfil '$PP_NAME' expiro el $PP_EXP"

# El perfil DEBE incluir el mismo cert con el que firmamos. Este fue el problema
# real de la 0.2.54: perfil del cert viejo (0544FB2C…) = "falta el provisioning profile".
N_CERTS="$(plutil -extract DeveloperCertificates raw "$PP_PLIST")"
MATCH=0
PP_CERTS=""
for ((i = 0; i < N_CERTS; i++)); do
  fp="$(plutil -extract "DeveloperCertificates.$i" raw "$PP_PLIST" | base64 -d \
        | openssl x509 -inform DER -noout -fingerprint -sha1 | sed 's/.*=//; s/://g')"
  PP_CERTS+="$fp "
  [[ "$fp" == "$APP_CERT_SHA1" ]] && MATCH=1
done
if (( MATCH == 0 )); then
  fail "el perfil '$PP_NAME' NO contiene el certificado de firma.
  Firmamos con:      $APP_CERT_SHA1  ($APP_IDENTITY)
  El perfil trae:    $PP_CERTS
  Es un perfil generado con un certificado viejo. Genera uno nuevo en el portal
  eligiendo el Apple Distribution vigente (Profiles -> + -> Mac App Store Connect)."
fi
log "OK: perfil '$PP_NAME' vigente hasta $PP_EXP y atado al cert $APP_CERT_SHA1"

# Copiar SIN xattrs: el perfil viene de una descarga del navegador y trae
# com.apple.quarantine (+ kMDItemWhereFroms, macl). `cp` los preserva.
ditto --noextattr --noqtn "$PROFILE" "$APP/Contents/embedded.provisionprofile"
rm -f "$PP_PLIST"

# ------------------------------------- 2b. verificar xattrs ANTES de firmar (ITMS-91109)
# Apple rechaza la entrega si algun archivo del payload lleva com.apple.quarantine
# (productbuild lo empaqueta como AppleDouble). Rechazo real de la 1a entrega 0.2.57.
# com.apple.macl tampoco debe viajar; `xattr -c` no lo borra (SIP), por eso las copias
# de arriba usan ditto --noextattr. com.apple.provenance lo pone el kernel a todo
# archivo nuevo, no se puede evitar y Apple lo tolera (el bundle procesado lo traia).
xattr -cr "$APP" 2>/dev/null || true
LEFT="$(find "$APP" -exec xattr {} \; 2>/dev/null | sort -u)"
if [[ "$LEFT" == *com.apple.quarantine* || "$LEFT" == *com.apple.macl* ]]; then
  fail "quedan xattrs prohibidos en el bundle (ITMS-91109): $LEFT"
fi
log "OK: bundle sin quarantine/macl (residuales tolerados: ${LEFT:-ninguno})"

# Reintento sobre la misma version: App Store Connect rechaza un segundo upload con
# el mismo CFBundleVersion (ITMS-90186 Redundant Binary Upload). BUILD_NUMBER solo
# toca CFBundleVersion; CFBundleShortVersionString sigue siendo la version del repo.
if [[ -n "${BUILD_NUMBER:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$APP/Contents/Info.plist"
  log "CFBundleVersion forzado a $BUILD_NUMBER (CFBundleShortVersionString=$VERSION)"
fi

# ------------------------------------------- 3. re-firmar de adentro hacia afuera
# Al incrustar el perfil cambia el bundle; hay que volver a firmar todo.
SIGN=(codesign --force --timestamp --options runtime --sign "$APP_IDENTITY")

# 3a. Sidecars (externalBin -> Contents/MacOS/<nombre>: llama-helper, ffmpeg) y
#     cualquier otro ejecutable que no sea el binario principal: sandbox heredado,
#     sin mas entitlements. Solo se recorre Contents/MacOS — un ejecutable en
#     Contents/Resources NO se firmaria aqui; por eso ffmpeg entra como externalBin.
while IFS= read -r bin; do
  [[ "$bin" == "$MAIN_BIN" ]] && continue
  log "firmando helper $(basename "$bin") (app-sandbox + inherit)"
  "${SIGN[@]}" --entitlements "$ENTITLEMENTS_INHERIT" "$bin"
done < <(find "$APP/Contents/MacOS" -type f -perm -u+x)

# 3b. Librerias y frameworks embebidos (si el bundle trae alguno).
if [[ -d "$APP/Contents/Frameworks" ]]; then
  while IFS= read -r lib; do
    log "firmando $(basename "$lib")"
    "${SIGN[@]}" "$lib"
  done < <(find "$APP/Contents/Frameworks" \( -name '*.dylib' -o -name '*.framework' \) -maxdepth 1)
fi

# 3c. La app, con los entitlements de App Store (sandbox).
log "firmando Maity.app con $APP_IDENTITY"
"${SIGN[@]}" --entitlements "$ENTITLEMENTS" "$APP"

codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | sed 's/^/  /'
log "entitlements efectivos del .app:"
codesign -d --entitlements :- "$APP" 2>/dev/null | sed 's/^/  /'

# Sanity: sandbox activo y identificador correcto (lo primero que revisa Apple).
# Capturar en variable, no `| grep -q`: con pipefail, grep cierra el pipe al
# primer match y codesign muere por SIGPIPE -> falso negativo.
APP_ENTS="$(codesign -d --entitlements :- "$APP" 2>/dev/null)"
[[ "$APP_ENTS" == *com.apple.security.app-sandbox* ]] \
  || fail "el .app quedo SIN app-sandbox — revisa $ENTITLEMENTS"
APP_SIGN_INFO="$(codesign -dv "$APP" 2>&1)"
[[ "$APP_SIGN_INFO" == *"Identifier=$BUNDLE_ID"* ]] \
  || fail "el .app no tiene Identifier=$BUNDLE_ID"

# --------------------------------------- 3d. copia de prueba bajo sandbox (#79)
# Un .app firmado con Apple Distribution + perfil de Mac App Store solo arranca
# instalado desde la Store/TestFlight. Para probar el sandbox en esta Mac se re-firma
# una copia con Developer ID, sin perfil y sin los entitlements que exigen perfil
# (application-identifier / team-identifier), conservando app-sandbox y el resto.
# Corre en ~/Library/Containers/com.maity.ai/ como el build real.
if (( SANDBOX_TEST )); then
  TEST_APP="$OUT_DIR/Maity-sandbox-test.app"
  log "generando copia de prueba sandbox: $TEST_APP"
  rm -rf "$TEST_APP"
  ditto --noextattr --noqtn "$APP" "$TEST_APP"
  rm -f "$TEST_APP/Contents/embedded.provisionprofile"

  TEST_ENTS="$(mktemp -t maity-sandbox-ents).plist"
  cp "$ENTITLEMENTS" "$TEST_ENTS"
  /usr/libexec/PlistBuddy -c "Delete :com.apple.application-identifier" "$TEST_ENTS"
  /usr/libexec/PlistBuddy -c "Delete :com.apple.developer.team-identifier" "$TEST_ENTS"

  SIGN_DEV=(codesign --force --timestamp --options runtime --sign "$DEV_ID_IDENTITY")
  TEST_MAIN_BIN="$TEST_APP/Contents/MacOS/maity-desktop"
  while IFS= read -r bin; do
    [[ "$bin" == "$TEST_MAIN_BIN" ]] && continue
    log "firmando helper $(basename "$bin") (Developer ID, app-sandbox + inherit)"
    "${SIGN_DEV[@]}" --entitlements "$ENTITLEMENTS_INHERIT" "$bin"
  done < <(find "$TEST_APP/Contents/MacOS" -type f -perm -u+x)
  if [[ -d "$TEST_APP/Contents/Frameworks" ]]; then
    while IFS= read -r lib; do
      "${SIGN_DEV[@]}" "$lib"
    done < <(find "$TEST_APP/Contents/Frameworks" \( -name '*.dylib' -o -name '*.framework' \) -maxdepth 1)
  fi
  log "firmando Maity-sandbox-test.app con $DEV_ID_IDENTITY"
  "${SIGN_DEV[@]}" --entitlements "$TEST_ENTS" "$TEST_APP"
  rm -f "$TEST_ENTS"

  codesign --verify --deep --strict --verbose=2 "$TEST_APP" 2>&1 | sed 's/^/  /'
  TEST_ENTS_OUT="$(codesign -d --entitlements :- "$TEST_APP" 2>/dev/null)"
  [[ "$TEST_ENTS_OUT" == *com.apple.security.app-sandbox* ]] \
    || fail "la copia de prueba quedo SIN app-sandbox"
  [[ "$TEST_ENTS_OUT" != *com.apple.application-identifier* ]] \
    || fail "la copia de prueba conserva application-identifier (no arrancaria sin perfil)"

  CONTAINER="$HOME/Library/Containers/$BUNDLE_ID/Data/Library/Application Support/Maity"
  log "LISTO (sandbox-test): $TEST_APP"
  cat <<EOF
  Como probar (sandbox REAL, sin pasar por la Store):
    1. Cierra cualquier otra instancia de Maity (single-instance por bundle id).
    2. open "$TEST_APP"
    3. Log del contenedor: "$CONTAINER/logs/"
    4. Login con Google -> lsof -nP -iTCP:17823 -sTCP:LISTEN debe listar maity-desktop (#76).
    5. Graba ~30 s -> en el log "Using bundled ffmpeg: .../Contents/MacOS/ffmpeg" y
       audio.mp4 en la carpeta de la reunion dentro del contenedor (#77).
  Ruido esperado bajo sandbox (no es bug): "single_instance failed to listen ...
  Operation not permitted" (el plugin usa /tmp, vetado por el sandbox).
  NO instales el .pkg en esta Mac: no arranca y pisa /Applications/Maity.app (#79).
EOF
  exit 0
fi

# ----------------------------------------------------------- 4. productbuild
log "generando $PKG"
rm -f "$PKG"
productbuild --component "$APP" /Applications --sign "$PKG_IDENTITY" "$PKG" | sed 's/^/  /'
pkgutil --check-signature "$PKG" | sed 's/^/  /'

# ------------------------------------- 5. validacion opcional con API key ASC
if [[ -n "${ASC_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" && -n "${ASC_KEY_PATH:-}" ]]; then
  # altool busca la llave en ~/.appstoreconnect/private_keys/AuthKey_<ID>.p8
  mkdir -p "$HOME/.appstoreconnect/private_keys"
  cp -n "$ASC_KEY_PATH" "$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8" 2>/dev/null || true
  log "validando con App Store Connect (altool)…"
  xcrun altool --validate-app -f "$PKG" -t macos --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
  log "validado. Para subir:"
  echo "  xcrun altool --upload-app -f \"$PKG\" -t macos --apiKey $ASC_KEY_ID --apiIssuer $ASC_ISSUER_ID"
else
  log "sin ASC_KEY_ID/ASC_ISSUER_ID/ASC_KEY_PATH: validar y subir con Transporter.app (Verify -> Deliver)"
fi

log "LISTO: $PKG"
