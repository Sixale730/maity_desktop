#!/usr/bin/env bash
# Compila un `ffmpeg` MINIMO y LGPL para macOS (universal arm64 + x86_64) y lo deja
# como sidecar de Tauri en src-tauri/binaries/ (issue #77).
#
# Por que existe:
#   - `audio/ffmpeg.rs` descargaba ffmpeg en runtime (evermeet.cx / osxexperts.net) a
#     ~/.local/bin. Bajo el sandbox de la Mac App Store eso no puede escribirse y,
#     aunque pudiera, ejecutar un binario descargado viola la guideline 2.5.2. Sin
#     ffmpeg no se genera `audio.mp4` al terminar una grabacion (rechazo 2.1).
#   - Los builds prehechos de terceros son GPL (libx264 & co.), y GPL + terminos de
#     la App Store es un conflicto conocido. Aqui se compila desde la fuente oficial
#     con `--disable-gpl --disable-nonfree`: el binario queda LGPL 2.1+ y se invoca
#     como proceso aparte (exec), asi que Maity no es obra derivada.
#   - Maity usa exactamente dos comandos (encode.rs: f32le -> aac/mp4 +faststart;
#     incremental_saver.rs: `-f concat -c copy`). Se habilita SOLO eso: ~5-10 MB por
#     slice en vez de ~80 MB. No hace falta nasm (--disable-x86asm: es solo audio).
#
# Salida (gitignored, la recoge `bundle.externalBin` de tauri.macos.conf.json):
#   src-tauri/binaries/ffmpeg-aarch64-apple-darwin      (tauri:build:debug en Apple Silicon)
#   src-tauri/binaries/ffmpeg-x86_64-apple-darwin       (idem en Intel)
#   src-tauri/binaries/ffmpeg-universal-apple-darwin    (--target universal-apple-darwin)
#   src-tauri/binaries/ffmpeg-LICENSE.txt, ffmpeg-COPYING.LGPLv2.1.txt
#   src-tauri/binaries/ffmpeg-macos.stamp               (version + hash de flags)
#
# Uso:
#   scripts/build-ffmpeg-macos.sh            # compila si falta o si cambio la receta
#   scripts/build-ffmpeg-macos.sh --check    # solo verifica (exit 1 si falta/desactualizado)
#   scripts/build-ffmpeg-macos.sh --force    # recompila aunque el stamp coincida
#   FFMPEG_WORK_DIR=~/.cache/maity-ffmpeg scripts/build-ffmpeg-macos.sh   # dir de trabajo (CI)
#
# Lo invoca run-pre-build-checks.js en macOS y build-macos.yml en CI. Requiere solo
# Xcode Command Line Tools (clang, lipo, make, tar con xz, curl, shasum).
set -euo pipefail

FFMPEG_VERSION="8.1.2"
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
# shasum -a 256 del tarball oficial (calculado el 25-ago-2026). Si ffmpeg.org lo
# cambiara, el build falla a proposito: nunca compilar una fuente no verificada.
FFMPEG_SHA256="464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"
MACOS_MIN="12.3"   # = bundle.macOS.minimumSystemVersion en tauri.conf.json

FRONTEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$FRONTEND_DIR/src-tauri"
BIN_DIR="$TAURI_DIR/binaries"
STAMP="$BIN_DIR/ffmpeg-macos.stamp"

log()  { printf '\033[1;34m[ffmpeg]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[ffmpeg] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

MODE="build"
case "${1:-}" in
  "") ;;
  --check) MODE="check" ;;
  --force) MODE="force" ;;
  *) fail "argumento desconocido: $1 (usa --check o --force)" ;;
esac

[[ "$(uname)" == "Darwin" ]] || fail "solo corre en macOS"

# Receta comun a las dos arquitecturas. Cualquier cambio aqui cambia el hash del
# stamp y fuerza la recompilacion. Mantener en sync con docs/THIRD-PARTY-NOTICES.md.
COMMON_FLAGS=(
  --disable-everything
  --disable-gpl --disable-nonfree --disable-version3
  --disable-network --disable-autodetect
  --disable-doc --disable-debug
  --disable-shared --enable-static --enable-pic
  --disable-ffplay --disable-ffprobe --enable-ffmpeg
  --disable-x86asm
  # encode.rs: -f f32le -i pipe:0 -c:a aac -profile:a aac_low -movflags +faststart -f mp4
  # incremental_saver.rs: -f concat -safe 0 -i list.txt -c copy out.mp4 (mov demuxer)
  --enable-demuxer=pcm_f32le,concat,mov
  --enable-decoder=pcm_f32le,aac
  --enable-encoder=aac
  --enable-muxer=mp4
  --enable-parser=aac
  --enable-bsf=aac_adtstoasc
  --enable-protocol=file,pipe
  # ffmpeg inserta aresample/aformat solos para convertir f32 interleaved -> fltp del
  # encoder; abuffer/abuffersink son los extremos del filtergraph implicito.
  --enable-filter=abuffer,abuffersink,anull,aformat,aresample
)
CONFIG_HASH="$(printf '%s\n' "$FFMPEG_VERSION" "$MACOS_MIN" "${COMMON_FLAGS[@]}" | shasum -a 256 | awk '{print $1}')"
WANT_STAMP="ffmpeg=$FFMPEG_VERSION config=$CONFIG_HASH"

OUT_UNIVERSAL="$BIN_DIR/ffmpeg-universal-apple-darwin"
OUT_ARM64="$BIN_DIR/ffmpeg-aarch64-apple-darwin"
OUT_X64="$BIN_DIR/ffmpeg-x86_64-apple-darwin"

is_current() {
  [[ -f "$STAMP" && -x "$OUT_UNIVERSAL" && -x "$OUT_ARM64" && -x "$OUT_X64" ]] || return 1
  [[ "$(cat "$STAMP")" == "$WANT_STAMP" ]]
}

if [[ "$MODE" == "check" ]]; then
  if is_current; then
    log "OK: ffmpeg $FFMPEG_VERSION LGPL presente en $BIN_DIR (stamp vigente)"
    exit 0
  fi
  fail "falta o esta desactualizado el ffmpeg bundleado. Corre: scripts/build-ffmpeg-macos.sh"
fi

if [[ "$MODE" == "build" ]] && is_current; then
  log "OK: ffmpeg $FFMPEG_VERSION ya compilado con esta receta ($BIN_DIR); nada que hacer"
  exit 0
fi

# ---------------------------------------------------------------- dir de trabajo
if [[ -n "${FFMPEG_WORK_DIR:-}" ]]; then
  WORK="$FFMPEG_WORK_DIR"
else
  # El target dir del WORKSPACE (raiz del repo), como en package-appstore.sh.
  TARGET_DIR="$(cd "$TAURI_DIR" && cargo metadata --format-version 1 --no-deps 2>/dev/null \
    | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).target_directory" 2>/dev/null || true)"
  [[ -n "$TARGET_DIR" ]] || TARGET_DIR="$(cd "$FRONTEND_DIR/.." && pwd)/target"
  WORK="$TARGET_DIR/ffmpeg-macos"
fi
mkdir -p "$WORK" "$BIN_DIR"
TARBALL="$WORK/ffmpeg-${FFMPEG_VERSION}.tar.xz"
SRC="$WORK/ffmpeg-${FFMPEG_VERSION}"
CACHE_OUT="$WORK/out"   # copia de la salida para no recompilar (CI cachea $WORK)
log "dir de trabajo: $WORK"

if [[ "$MODE" == "build" && -f "$CACHE_OUT/ffmpeg-macos.stamp" \
      && "$(cat "$CACHE_OUT/ffmpeg-macos.stamp")" == "$WANT_STAMP" ]]; then
  log "restaurando salida cacheada desde $CACHE_OUT"
  cp "$CACHE_OUT"/ffmpeg-* "$BIN_DIR/"
  chmod 755 "$OUT_UNIVERSAL" "$OUT_ARM64" "$OUT_X64"
  is_current && { log "OK: ffmpeg $FFMPEG_VERSION restaurado del cache"; exit 0; }
  log "el cache no era valido; recompilando"
fi

# ---------------------------------------------------------------- 1. fuente
sha_ok() { [[ -f "$1" && "$(shasum -a 256 "$1" | awk '{print $1}')" == "$FFMPEG_SHA256" ]]; }
if ! sha_ok "$TARBALL"; then
  log "descargando $FFMPEG_URL"
  rm -f "$TARBALL"
  curl -fL --retry 3 --retry-delay 5 -o "$TARBALL" "$FFMPEG_URL"
  sha_ok "$TARBALL" || fail "SHA-256 del tarball NO coincide con el pineado ($FFMPEG_SHA256). No se compila."
fi
log "OK: tarball verificado (sha256 $FFMPEG_SHA256)"

if [[ ! -f "$SRC/configure" ]]; then
  rm -rf "$SRC"
  tar -xJf "$TARBALL" -C "$WORK"
  [[ -f "$SRC/configure" ]] || fail "el tarball no trae $SRC/configure"
fi

# ---------------------------------------------------------------- 2. compilar
NCPU="$(sysctl -n hw.ncpu)"

build_arch() {
  local arch="$1" out="$2"
  local bdir="$WORK/build-$arch"
  local extra=()
  if [[ "$arch" == "x86_64" && "$(uname -m)" != "x86_64" ]]; then
    extra+=(--enable-cross-compile --arch=x86_64 --target-os=darwin --cc="clang -arch x86_64")
  elif [[ "$arch" == "arm64" && "$(uname -m)" != "arm64" ]]; then
    extra+=(--enable-cross-compile --arch=arm64 --target-os=darwin --cc="clang -arch arm64")
  else
    extra+=(--arch="$arch")
  fi
  rm -rf "$bdir"
  mkdir -p "$bdir"
  log "configure ($arch) — log en $bdir/configure.log"
  (
    cd "$bdir"
    "$SRC/configure" "${COMMON_FLAGS[@]}" "${extra[@]}" \
      --extra-cflags="-mmacosx-version-min=$MACOS_MIN -O2" \
      --extra-ldflags="-mmacosx-version-min=$MACOS_MIN" \
      > configure.log 2>&1 || { tail -40 configure.log >&2; exit 1; }
    make -j"$NCPU" ffmpeg > make.log 2>&1 || { tail -40 make.log >&2; exit 1; }
  ) || fail "fallo la compilacion para $arch"
  strip -o "$out" "$bdir/ffmpeg"
  chmod 755 "$out"
  log "OK: $arch -> $(du -h "$out" | awk '{print $1}') $out"
}

build_arch arm64  "$OUT_ARM64"
build_arch x86_64 "$OUT_X64"

lipo -create "$OUT_ARM64" "$OUT_X64" -output "$OUT_UNIVERSAL"
chmod 755 "$OUT_UNIVERSAL"

# ---------------------------------------------------------------- 3. verificar
ARCHS="$(lipo -archs "$OUT_UNIVERSAL")"
[[ "$ARCHS" == *x86_64* && "$ARCHS" == *arm64* ]] || fail "el universal no trae ambas archs: $ARCHS"

VERSION_OUT="$("$OUT_UNIVERSAL" -hide_banner -version 2>&1)"
[[ "$VERSION_OUT" == *"ffmpeg version ${FFMPEG_VERSION}"* ]] || fail "version inesperada: $(head -1 <<<"$VERSION_OUT")"
[[ "$VERSION_OUT" == *"--disable-gpl"* ]] || fail "la configuracion no lleva --disable-gpl"
[[ "$VERSION_OUT" != *"--enable-gpl"* && "$VERSION_OUT" != *"--enable-nonfree"* ]] \
  || fail "el binario reporta GPL/nonfree — no es distribuible en App Store"

# Sin dependencias fuera del sistema (nada de /opt/homebrew, /usr/local). En un binario
# fat otool imprime una cabecera por arquitectura; las dependencias son las lineas
# indentadas con tab.
DEPS="$(otool -L "$OUT_UNIVERSAL" | grep $'^\t' | awk '{print $1}')"
if grep -vE '^(/usr/lib/|/System/Library/)' <<<"$DEPS" | grep -q .; then
  fail "ffmpeg enlaza librerias fuera del sistema: $(grep -vE '^(/usr/lib/|/System/Library/)' <<<"$DEPS" | tr '\n' ' ')"
fi
"$OUT_UNIVERSAL" -hide_banner -encoders 2>/dev/null | grep -q ' aac ' || fail "falta el encoder aac"
"$OUT_UNIVERSAL" -hide_banner -demuxers 2>/dev/null | grep -q ' concat ' || fail "falta el demuxer concat"
"$OUT_UNIVERSAL" -hide_banner -muxers 2>/dev/null | grep -q ' mp4 ' || fail "falta el muxer mp4"

# Licencia junto a los binarios (referencia; no viaja en el bundle).
cp "$SRC/LICENSE.md" "$BIN_DIR/ffmpeg-LICENSE.txt"
cp "$SRC/COPYING.LGPLv2.1" "$BIN_DIR/ffmpeg-COPYING.LGPLv2.1.txt"

printf '%s\n' "$WANT_STAMP" > "$STAMP"
rm -rf "$CACHE_OUT"
mkdir -p "$CACHE_OUT"
cp "$OUT_UNIVERSAL" "$OUT_ARM64" "$OUT_X64" "$STAMP" \
   "$BIN_DIR/ffmpeg-LICENSE.txt" "$BIN_DIR/ffmpeg-COPYING.LGPLv2.1.txt" "$CACHE_OUT/"
log "LISTO: ffmpeg $FFMPEG_VERSION LGPL universal ($ARCHS), $(du -h "$OUT_UNIVERSAL" | awk '{print $1}')"
log "  $OUT_UNIVERSAL"
log "  $OUT_ARM64"
log "  $OUT_X64"
