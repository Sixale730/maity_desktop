# Avisos de software de terceros

Componentes redistribuidos **como binarios aparte** dentro del bundle de Maity Desktop
(no enlazados al ejecutable). Las dependencias de Rust/npm enlazadas se listan en
`Cargo.lock` / `pnpm-lock.yaml` con sus propias licencias.

## FFmpeg

Maity redistribuye **dos binarios de FFmpeg distintos**, uno por plataforma. Ambos se
ejecutan como **proceso independiente** (`std::process::Command`) para dos cosas:
codificar la grabación PCM a AAC/MP4 (`audio/encode.rs`) y unir los checkpoints de 30 s
sin recodificar (`audio/incremental_saver.rs`). No se enlaza ninguna librería de FFmpeg;
Maity no es obra derivada.

### macOS — compilado desde la fuente (LGPL-2.1+)

- **Versión:** 8.1.2 ("Hoare"), fuente oficial `https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz`
  (SHA-256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`).
- **Licencia:** GNU Lesser General Public License v2.1 o posterior (LGPL-2.1+).
  Copyright © the FFmpeg developers. Texto completo: `COPYING.LGPLv2.1` del tarball
  (copiado junto al binario como `frontend/src-tauri/binaries/ffmpeg-COPYING.LGPLv2.1.txt`
  al compilar). Ese archivo **NO viaja hoy dentro del `.app`** — `tauri.macos.conf.json`
  no lo declara en `bundle.resources` —, así que al usuario de macOS sólo le llega el
  aviso de Ajustes → Acerca de. Pendiente de decidir (en Windows sí se embarca).
- **Dónde va:** `Maity.app/Contents/MacOS/ffmpeg` (sidecar `externalBin`, ambos canales:
  `.dmg` y Mac App Store).
- **Cómo se compila** (`frontend/scripts/build-ffmpeg-macos.sh`, reproducible; sólo Xcode
  Command Line Tools):

  ```
  ./configure --disable-everything --disable-gpl --disable-nonfree --disable-version3 \
    --disable-network --disable-autodetect --disable-doc --disable-debug \
    --disable-shared --enable-static --enable-pic \
    --disable-ffplay --disable-ffprobe --enable-ffmpeg --disable-x86asm \
    --enable-demuxer=pcm_f32le,concat,mov --enable-decoder=pcm_f32le,aac \
    --enable-encoder=aac --enable-muxer=mp4 --enable-parser=aac \
    --enable-bsf=aac_adtstoasc --enable-protocol=file,pipe \
    --enable-filter=abuffer,abuffersink,anull,aformat,aresample \
    --extra-cflags="-mmacosx-version-min=12.3 -O2" --extra-ldflags="-mmacosx-version-min=12.3"
  ```
  Una pasada nativa `arm64` y otra cruzada `x86_64` (`--enable-cross-compile
  --arch=x86_64 --target-os=darwin --cc="clang -arch x86_64"`), unidas con `lipo`.
  **Sin componentes GPL ni "nonfree"**: el resultado es LGPL y distribuible en la Mac
  App Store. `ffmpeg -version` del binario embarcado imprime esta configuración.
- **Fuente:** el código de FFmpeg no se modifica. Cualquier usuario puede obtener la
  misma fuente en la URL de arriba y reconstruir el binario con el script.

### Windows — prebuilt LGPL de BtbN (LGPL-3.0)

- **Origen:** build oficial de [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds),
  variante `win64-lgpl`. Tag de autobuild **fijo** (nunca `latest`):
  `autobuild-2026-09-04-14-01`, asset
  `ffmpeg-n8.1.2-50-g1a748fe2cd-win64-lgpl-8.1.zip`
  (146.078.607 bytes, SHA-256
  `aaea14506158ce84049a35139512e75a1628dd7641813c273d0b9f4bdb2f8b72`).
  Serie n8.1, la misma que se compila en macOS.
- **Licencia:** GNU Lesser General Public License **v3** (LGPL-3.0). Los builds `lgpl`
  de BtbN pasan `--enable-version3` a `configure`
  (`variants/defaults-lgpl.sh`: `FF_CONFIGURE="--enable-version3 --disable-debug"`,
  `LICENSE_FILE="COPYING.LGPLv3"`), lo que eleva a v3 los componentes LGPL-2.1+. El
  texto completo viaja junto al binario como `ffmpeg-LICENSE.txt`, copiado literalmente
  del `LICENSE.txt` del zip: en el NSIS por `bundle.resources` de
  `frontend/src-tauri/tauri.windows.conf.json` (destino `""` = el dir del `.exe`) y en el
  MSIX por la copia que `scripts/stage-ffmpeg-windows.js` hace a `msix_staging/`.
- **NO es la receta mínima de macOS.** Es un build genérico y estático con el catálogo
  completo de codecs no-GPL (~100 MB frente a los ~5-10 MB del compilado a medida). No
  se compila desde fuente en Windows porque exigiría MSYS2 + `make` + un gcc moderno,
  toolchain que ni las máquinas de desarrollo ni los runners de CI del proyecto tienen
  instalado. Maity sigue usando exactamente los mismos dos comandos.
- **Cómo se verifica que es el LGPL y no el GPL:** BtbN **no** pasa `--disable-gpl`, así
  que ese flag no aparece en `ffmpeg -version`. La verificación (en
  `frontend/scripts/stage-ffmpeg-windows.js` y en `scripts/smoke-test-startup.ps1`) es
  que la línea `configuration:` **no contenga** `--enable-gpl` ni `--enable-nonfree` y
  **sí** contenga `--enable-version3` — el único delta de `variants/defaults-gpl.sh`
  frente a `defaults-lgpl.sh` es precisamente `--enable-gpl`.
- **Dónde va:** `ffmpeg.exe` junto al ejecutable en los dos canales de Windows, pero por
  vías **distintas**: el NSIS de GitHub Releases lo recibe vía `bundle.externalBin` de
  `frontend/src-tauri/tauri.windows.conf.json`; el MSIX de la Microsoft Store, copiado a
  `msix_staging/` por `frontend/scripts/stage-ffmpeg-windows.js`, porque el canal Store
  compila con `tauri build --no-bundle` y eso **no** copia `externalBin` al output.
- **Fuente:** BtbN publica los Dockerfiles y scripts que producen el binario en el mismo
  repositorio; el código de FFmpeg no se modifica.

- **Aviso en la app:** Ajustes → Acerca de → "Incluye FFmpeg (LGPL v2.1 o posterior)".
