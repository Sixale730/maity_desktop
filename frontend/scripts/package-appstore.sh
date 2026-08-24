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
#
# Requiere antes:  pnpm run tauri:build:appstore
# Validacion opcional por terminal (si no, usar Transporter.app):
#   ASC_KEY_ID=XXXX ASC_ISSUER_ID=uuid ASC_KEY_PATH=~/Downloads/AuthKey_XXXX.p8 scripts/package-appstore.sh
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
PROFILE="${1:-$TAURI_DIR/embedded.provisionprofile}"

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

# SHA-1 del cert Apple Distribution que vamos a usar (lo que lista find-identity).
APP_CERT_SHA1="$(security find-identity -v -p codesigning \
  | grep -F "$APP_IDENTITY" | awk '{print $2}' | head -1)"
[[ -n "$APP_CERT_SHA1" ]] || fail "no pude leer el SHA-1 del certificado de firma"

# ------------------------------------------------- 1. copia limpia a staging
log "version $VERSION — staging en $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
# ditto preserva xattrs/permisos; cp -R rompe symlinks de frameworks.
ditto "$APP_SRC" "$APP"

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

cp "$PROFILE" "$APP/Contents/embedded.provisionprofile"
rm -f "$PP_PLIST"

# ------------------------------------------- 3. re-firmar de adentro hacia afuera
# Al incrustar el perfil cambia el bundle; hay que volver a firmar todo.
SIGN=(codesign --force --timestamp --options runtime --sign "$APP_IDENTITY")

# 3a. Sidecars (externalBin -> Contents/MacOS/<nombre>) y cualquier otro ejecutable
#     que no sea el binario principal: sandbox heredado, sin mas entitlements.
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
codesign -d --entitlements :- "$APP" 2>/dev/null | grep -q 'com.apple.security.app-sandbox' \
  || fail "el .app quedo SIN app-sandbox — revisa $ENTITLEMENTS"
codesign -dv "$APP" 2>&1 | grep -q "Identifier=$BUNDLE_ID" \
  || fail "el .app no tiene Identifier=$BUNDLE_ID"

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
