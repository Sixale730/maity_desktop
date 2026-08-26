# Avisos de software de terceros

Componentes redistribuidos **como binarios aparte** dentro del bundle de Maity Desktop
(no enlazados al ejecutable). Las dependencias de Rust/npm enlazadas se listan en
`Cargo.lock` / `pnpm-lock.yaml` con sus propias licencias.

## FFmpeg

- **Versión:** 8.1.2 ("Hoare"), fuente oficial `https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz`
  (SHA-256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`).
- **Licencia:** GNU Lesser General Public License v2.1 o posterior (LGPL-2.1+).
  Copyright © the FFmpeg developers. Texto completo: `COPYING.LGPLv2.1` del tarball
  (copiado junto al binario como `frontend/src-tauri/binaries/ffmpeg-COPYING.LGPLv2.1.txt`
  al compilar).
- **Dónde va:** macOS → `Maity.app/Contents/MacOS/ffmpeg` (sidecar `externalBin`,
  ambos canales: `.dmg` y Mac App Store). Windows → `ffmpeg.exe` junto al ejecutable
  (canal Microsoft Store, ver `.claude/skills/store-msix/SKILL.md`).
- **Cómo se usa:** Maity lo ejecuta como **proceso independiente** (`std::process::Command`)
  para dos cosas: codificar la grabación PCM a AAC/MP4 (`audio/encode.rs`) y unir los
  checkpoints de 30 s sin recodificar (`audio/incremental_saver.rs`). No se enlaza ninguna
  librería de FFmpeg; Maity no es obra derivada.
- **Cómo se compila el binario de macOS** (`frontend/scripts/build-ffmpeg-macos.sh`,
  reproducible; solo Xcode Command Line Tools):

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
- **Aviso en la app:** Ajustes → Acerca de → "Incluye FFmpeg (LGPL v2.1 o posterior)".
