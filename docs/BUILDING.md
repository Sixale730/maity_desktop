# Building Maity from Source

This guide provides detailed instructions for building Maity from source on different operating systems.

<details>
<summary>Linux</summary>

## 🐧 Building on Linux

This guide helps you build Maity on Linux with **automatic GPU acceleration**. The build system detects your hardware and configures the best performance automatically.

---

### 🚀 Quick Start (Recommended for Beginners)

If you're new to building on Linux, start here. These simple commands work for most users:

#### 1. Install Basic Dependencies

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install build-essential cmake git

# Fedora/RHEL
sudo dnf install gcc-c++ cmake git

# Arch Linux
sudo pacman -S base-devel cmake git
```

#### 2. Build and Run

```bash
# Development mode (with hot reload)
./dev-gpu.sh

# Production build
./build-gpu.sh
```

**That's it!** The scripts automatically detect your GPU and configure acceleration.

### What Happens Automatically?

- ✅ **NVIDIA GPU** → CUDA acceleration (if toolkit installed)
- ✅ **AMD GPU** → ROCm acceleration (if ROCm installed)
- ✅ **No GPU** → Optimized CPU mode (still works great!)

> 💡 **Tip:** If you have an NVIDIA or AMD GPU but want better performance, jump to the [GPU Setup](#-gpu-setup-guides-intermediate) section below.

---

### 🧠 Understanding Auto-Detection

The build scripts (`dev-gpu.sh` and `build-gpu.sh`) orchestrate the entire build process. Here's how they work:

1.  **Detect location:** Find `package.json` (works from project root or `frontend/`)
2.  **Auto-detect GPU:** Run `scripts/auto-detect-gpu.js` (or use `TAURI_GPU_FEATURE` if set)
3.  **Build Sidecar:** Build `llama-helper` with the detected feature (debug or release)
4.  **Copy Binary:** Copy the built sidecar to `src-tauri/binaries` with the target triple
5.  **Run Tauri:** Call `npm run tauri:dev` or `tauri:build` with the feature flag passed via env var

#### Detection Priority

| Priority | Hardware        | What It Checks                                               | Result                  |
| -------- | --------------- | ------------------------------------------------------------ | ----------------------- |
| 1️⃣       | **NVIDIA CUDA** | `nvidia-smi` exists + (`CUDA_PATH` or `nvcc` found)          | `--features cuda`       |
| 2️⃣       | **AMD ROCm**    | `rocm-smi` exists + (`ROCM_PATH` or `hipcc` found)           | `--features hipblas`    |
| 3️⃣       | **Vulkan**      | `vulkaninfo` exists + `VULKAN_SDK` + `BLAS_INCLUDE_DIRS` set | `--features vulkan`     |
| 4️⃣       | **OpenBLAS**    | `BLAS_INCLUDE_DIRS` set                                      | `--features openblas`   |
| 5️⃣       | **CPU-only**    | None of the above                                            | (no features, pure CPU) |

#### Common Scenarios

| Your System               | Auto-Detection Result       | Why                          |
| ------------------------- | --------------------------- | ---------------------------- |
| Clean Linux install       | CPU-only                    | No GPU SDK detected          |
| NVIDIA GPU + drivers only | CPU-only                    | CUDA toolkit not installed   |
| NVIDIA GPU + CUDA toolkit | **CUDA acceleration** ✅    | Full detection successful    |
| AMD GPU + ROCm            | **HIPBlas acceleration** ✅ | Full detection successful    |
| Vulkan drivers only       | CPU-only                    | Vulkan SDK + env vars needed |
| Vulkan SDK configured     | **Vulkan acceleration** ✅  | All requirements met         |

> 💡 **Key Insight:** Having GPU drivers alone isn't enough. You need the **development SDK** (CUDA toolkit, ROCm, or Vulkan SDK) for acceleration.

---

### 🔧 GPU Setup Guides (Intermediate)

Want better performance? Follow these guides to enable GPU acceleration.

#### 🟢 NVIDIA CUDA Setup

**Prerequisites:** NVIDIA GPU with compute capability 5.0+ (check: `nvidia-smi --query-gpu=compute_cap --format=csv`)

##### Step 1: Install CUDA Toolkit

```bash
# Ubuntu/Debian (CUDA 12.x)
sudo apt install nvidia-driver-550 nvidia-cuda-toolkit

# Verify installation
nvidia-smi          # Shows GPU info
nvcc --version      # Shows CUDA version
```

##### Step 2: Build with CUDA

```bash
# Set your GPU's compute capability
# Example: RTX 3080 = 8.6 → use "86"
# Example: GTX 1080 = 6.1 → use "61"

CMAKE_CUDA_ARCHITECTURES=75 \
CMAKE_CUDA_STANDARD=17 \
CMAKE_POSITION_INDEPENDENT_CODE=ON \
./build-gpu.sh
```

> 💡 **Finding Your Compute Capability:**
>
> ```bash
> nvidia-smi --query-gpu=compute_cap --format=csv
> ```
>
> Convert `7.5` → `75`, `8.6` → `86`, etc.

**Why these flags?**

- `CMAKE_CUDA_ARCHITECTURES`: Optimizes for your specific GPU
- `CMAKE_CUDA_STANDARD=17`: Ensures C++17 compatibility
- `CMAKE_POSITION_INDEPENDENT_CODE=ON`: Fixes linking issues on modern systems

---

#### 🔵 Vulkan Setup (Cross-Platform Fallback)

Vulkan works on NVIDIA, AMD, and Intel GPUs. Good choice if CUDA/ROCm don't work.

##### Step 1: Install Vulkan SDK and BLAS

```bash
# Ubuntu/Debian
sudo apt install vulkan-sdk libopenblas-dev

# Fedora
sudo dnf install vulkan-devel openblas-devel

# Arch Linux
sudo pacman -S vulkan-devel openblas
```

##### Step 2: Configure Environment

```bash
# Add to ~/.bashrc or ~/.zshrc
export VULKAN_SDK=/usr
export BLAS_INCLUDE_DIRS=/usr/include/x86_64-linux-gnu

# Apply changes
source ~/.bashrc
```

##### Step 3: Build

```bash
./build-gpu.sh
```

The script will automatically detect Vulkan and build with `--features vulkan`.

---

#### 🔴 AMD ROCm Setup (AMD GPUs Only)

**Prerequisites:** AMD GPU with ROCm support (RX 5000+, Radeon VII, etc.)

```bash
# Ubuntu/Debian
# Add ROCm repository (see https://rocm.docs.amd.com for latest)
sudo apt install rocm-smi hipcc

# Set environment
export ROCM_PATH=/opt/rocm

# Verify
rocm-smi            # Shows GPU info
hipcc --version     # Shows ROCm version

# Build
./build-gpu.sh
```

---

### 🎯 Advanced Usage

#### Manual Feature Override

Want to force a specific acceleration method? Use the `TAURI_GPU_FEATURE` environment variable with the shell scripts:

```bash
# Force CUDA (ignore auto-detection)
TAURI_GPU_FEATURE=cuda ./dev-gpu.sh
TAURI_GPU_FEATURE=cuda ./build-gpu.sh

# Force Vulkan
TAURI_GPU_FEATURE=vulkan ./dev-gpu.sh
TAURI_GPU_FEATURE=vulkan ./build-gpu.sh

# Force ROCm (HIPBlas)
TAURI_GPU_FEATURE=hipblas ./dev-gpu.sh
TAURI_GPU_FEATURE=hipblas ./build-gpu.sh

# Force CPU-only (releases de Windows/Linux van SIEMPRE así, ver § #31 al final)
TAURI_GPU_FEATURE=none ./dev-gpu.sh
TAURI_GPU_FEATURE=none ./build-gpu.sh
# (`TAURI_GPU_FEATURE=""` vacío también es CPU desde sep-2026; antes caía en auto-detect)

# Force OpenBLAS (CPU-optimized)
TAURI_GPU_FEATURE=openblas ./dev-gpu.sh
TAURI_GPU_FEATURE=openblas ./build-gpu.sh
```

#### Build Output Location

After successful build:

```
src-tauri/target/release/bundle/appimage/Maity_<version>_amd64.AppImage
```

---

### 🧭 Troubleshooting

#### "CUDA toolkit not found"

- **Fix:** Install `nvidia-cuda-toolkit` or set `CUDA_PATH` environment variable
- **Check:** `nvcc --version` should work

#### "Vulkan detected but missing dependencies"

- **Fix:** Set both `VULKAN_SDK` and `BLAS_INCLUDE_DIRS` environment variables
- **Example:**
  ```bash
  export VULKAN_SDK=/usr
  export BLAS_INCLUDE_DIRS=/usr/include/x86_64-linux-gnu
  ```

#### "AppImage build stripping symbols"

- **Fix:** Already handled! `build-gpu.sh` sets `NO_STRIP=true` automatically
- **Why:** Prevents runtime errors from missing symbols

#### Build works but no GPU acceleration

- **Check detection:** Look at the build output for GPU detection messages
- **Verify:** `nvidia-smi` (NVIDIA) or `rocm-smi` (AMD) should work
- **Missing SDK:** Install the development toolkit, not just drivers

</details>

<details>
<summary>macOS</summary>

## 🍎 Building on macOS

On macOS, the build process is simplified as GPU acceleration (Metal) is enabled by default.

### 1. Install Dependencies

```bash
# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install required tools
brew install cmake node pnpm
```

### 2. Build and Run

```bash
# Development mode (with hot reload)
pnpm tauri:dev

# Production build
pnpm tauri:build
```

The application will be built with Metal GPU acceleration automatically.

</details>

<details>
<summary>Windows</summary>

## 🪟 Building on Windows

### 1. Install Dependencies

- **Node.js:** Download and install from [nodejs.org](https://nodejs.org/).
- **Rust:** Install from [rust-lang.org](https://www.rust-lang.org/tools/install).
- **Visual Studio Build Tools:** Install the "Desktop development with C++" workload from the Visual Studio Installer.
- **CMake:** Download and install from [cmake.org](https://cmake.org/download/).

### 2. Build and Run

```powershell
# Development mode (with hot reload)
pnpm tauri:dev

# Production build
pnpm tauri:build
```

By default, the application will be built with CPU-only processing. To enable GPU acceleration, see the [GPU Acceleration Guide](GPU_ACCELERATION.md).

</details>

## ffmpeg viaja DENTRO del bundle en macOS y en Windows (ago-2026 #77; sep-2026 #32)

> Extraído de CLAUDE.md (sep-2026). Reglas de cumplimiento obligatorio al tocar el build, el staging o `audio/ffmpeg.rs`.

`audio/ffmpeg.rs` lo descargaba en runtime — en macOS a `~/.local/bin` escribiendo además en `.zshrc`; en Windows el zip de `gyan.dev` (106 MB, **GPLv3**) al **primer checkpoint de 30 s de una grabación**, dentro del `spawn_blocking` que retiene el único permiso del semáforo de `IncrementalAudioSaver` (el `checkpoint_buffer` crece sin tope mientras tanto y `finalize()` tiene un timeout de 300 s). Bajo el sandbox de la Mac App Store eso no se puede escribir y ejecutar un binario descargado viola la guideline 2.5.2; bajo MSIX el directorio del paquete es de sólo lectura. Hoy:
- **macOS:** `frontend/scripts/build-ffmpeg-macos.sh` **compila desde la fuente oficial pineada por SHA-256** un ffmpeg mínimo y **LGPL-2.1+** (`--disable-gpl --disable-nonfree`, sólo lo que usan `encode.rs` e `incremental_saver.rs`; ~5-10 MB por slice, sin nasm) → `binaries/ffmpeg-{aarch64,x86_64,universal}-apple-darwin`.
- **Windows:** `frontend/scripts/stage-ffmpeg-windows.js` **descarga un prebuilt LGPL de BtbN/FFmpeg-Builds con tag de autobuild FIJO y SHA-256 del zip pineados**, extrae SÓLO `bin/ffmpeg.exe` con el `tar.exe` (bsdtar) de System32 y lo deja en `binaries/ffmpeg-x86_64-pc-windows-msvc.exe` (+ `ffmpeg-LICENSE.txt`, + copia de ambos a `msix_staging/` — en los DOS caminos del script, también el idempotente: ese directorio está gitignored y se recrea entre ciclos, así que copiar sólo tras una extracción fresca dejaría MSIX sin ffmpeg y sin que nada lo atrapara). No se compila desde fuente porque exigiría MSYS2 + make + gcc moderno, que ni esta máquina ni los runners de CI tienen. Idempotente por stamp (`binaries/ffmpeg-windows.stamp`) y por SHA del exe presente. **El binario de Windows es LGPL v3** (los builds `lgpl` de BtbN pasan `--enable-version3`), no v2.1 como el de macOS.
- **Verificación de licencia — ojo con el flag:** los builds de BtbN **no** pasan `--disable-gpl` a configure, así que ese flag NUNCA aparece en `ffmpeg -version`. El discriminante real entre `lgpl` y `gpl` es **la ausencia de `--enable-gpl`** (`variants/defaults-gpl.sh` = `--enable-gpl --enable-version3 --disable-debug`; `defaults-lgpl.sh` = `--enable-version3 --disable-debug`). Eso es lo que verifican el stage script y `scripts/smoke-test-startup.ps1`. En macOS sí se exige `--disable-gpl` porque el script lo pasa explícitamente.
- **Regla exe-folder-first:** `find_ffmpeg_path` mira **primero** junto al ejecutable en macOS **y en Windows**, antes que PATH. Efecto lateral en Windows: un `ffmpeg.exe` residual en `target/debug` o `target/release` (p. ej. el de gyan.dev de una descarga vieja) le gana al PATH — por eso el stage script borra cualquiera cuyo SHA no sea el pineado y el smoke compara SHA contra `binaries/`.
- **El resolver es REINTENTABLE.** `FFMPEG_PATH` es un `OnceLock<PathBuf>` que **sólo cachea el éxito** (+ un `Mutex<()>` que serializa los intentos). Con el `Lazy<Option<PathBuf>>` anterior, un `None` transitorio se memorizaba para todo el proceso y a partir de ahí `finalize()` abortaba: **reunión entera perdida**. Es también lo que hace que siga funcionando el rescate en caliente de `winapp run` (copiar `ffmpeg.exe` con la app corriendo). Hay un warm-up **detached** (`spawn_blocking`) en el `setup` de `lib.rs`, después de la init de DB: nunca en línea dentro del spawn secuencial de config.
- **No borrar `handle_ffmpeg_installation`**: Linux la sigue usando (`build-linux.yml` no compila ffmpeg) y es el fallback de dev sin bundle. Sí se limpian ahora `ffprobe`/`ffplay` tras el `unpack` (cero call sites en `src-tauri/src`), pero **sólo los que dejó ese `unpack`**: se toma una foto del directorio ANTES y lo preexistente no se toca, porque el destino NO es privado de la app fuera de Windows (`~/.local/bin` en macOS, la carpeta del ejecutable —`/usr/bin` en un `.deb`— en Linux) y el guard de `handle_ffmpeg_installation` sólo mira si hay `ffmpeg`, así que un usuario con su propio `ffprobe` ahí es un caso alcanzable.
- **Todo entrypoint que llame a `tauri dev`/`tauri build` en Windows tiene que stagear ffmpeg antes**: `binaries/` está gitignored y `externalBin` es un requisito **duro** del `build.rs` de Tauri (`ResourcePathNotFound` aborta el `cargo build`, no sólo el bundler). Por eso el script se encadena en `tauri:dev`, `tauri:build:store`, los `tauri:{dev,build}:{cpu,cuda,vulkan,…}` por GPU y el pre-build de `tauri:build*`; y `clean_run_windows.bat`/`clean_build_windows.bat` invocan los scripts de pnpm, no `tauri` pelado. En CI lo stagean `build.yml`, `build-windows.yml` y `build-devtest.yml`. Los escapes `tauri:build*:skip-checks` siguen sin stage a propósito.
- Otras reglas que siguen vigentes: (a) **nunca `bundle.resources`** para ejecutables en macOS (`package-appstore.sh` sólo firma con `inherit` los de `Contents/MacOS`); (b) `tauri.<plataforma>.conf.json` **reemplaza** el array `externalBin`, no lo concatena — hay que repetir `binaries/llama-helper` en los dos overrides; (c) aviso de licencia en Ajustes → Acerca de y en `docs/THIRD-PARTY-NOTICES.md`, en sync con la receta.

## GC del `target/` (sep-2026)

> Extraído de CLAUDE.md (sep-2026).

Cargo crea una carpeta `target/<perfil>/incremental/<crate>-<hash>/` por combinación de perfil (dev/test/check), features y flags, y **nunca borra las viejas**: llegaron a 43.7 GB en ~40 sesiones de `app_lib` (+5 GB de rlibs hasheados en `deps/`) y el build murió con `os error 112` con 0.8 GB libres. `frontend/scripts/gc-target-dir.js` corre como **primer** paso de `run-pre-build-checks.js` y de `tauri:dev`: borra sesiones sin uso >7 días y, si el incremental pasa de 12 GB, las más viejas — **nunca la sesión caliente de cada crate** —, y los artefactos hasheados viejos de `app_lib`/`maity_desktop` en `deps/`; con <15 GB libres avisa y con <5 GB **falla el build** (moriría igual a mitad del link: `app_lib.lib` pesa 2.4 GB). Manual: `pnpm run target:gc` / `target:gc:dry` (reporte con 🔥 = caliente). Umbrales por env `MAITY_TARGET_GC_STALE_DAYS` / `MAITY_TARGET_GC_MAX_INCREMENTAL_GB`; escapes `MAITY_TARGET_GC_SKIP=1` / `MAITY_TARGET_GC_NO_FAIL=1`. Un ciclo `cargo test` + build debug consume ~10 GB (test ≈ 1.8 GB, build ≈ 6 GB). Si aun así estorba: `cargo clean -p maity-desktop` (tira también la caliente: +2-3 min al siguiente build). **Nightshift bloquea `rm -r` y `Remove-Item -Recurse` en duro**; por eso el borrado vive en un script de Node y no en un comando.

## Dependencias Rust: una sola pila TLS (rustls 0.23 + ring) y cero deps muertas (sep-2026, #35 de la auditoría de recursos)

> Extraído de CLAUDE.md (sep-2026). Reglas de cumplimiento obligatorio al tocar `Cargo.toml` o subir dependencias.

Hasta entonces el exe compilaba rustls 0.22 **y** 0.23 (sentry 0.34 traía `rustls 0.22.4` directo y tokio-tungstenite 0.21 su propia pila), dos reqwest (0.12 nuestro + 0.13 del updater), dos zip, dos dirs, clap 3 y 4, y `esaxx-rs`/`symphonia`/`clap` sin un solo call site; 751 → 667 crates. Reglas, todas deliberadas:
- **reqwest 0.13 renombró las features TLS y la nueva `rustls` enciende aws-lc-rs.** `rustls-tls` → `rustls` (= rustls + **aws-lc-rs**), y las `*-native-roots`/`*-webpki-roots` desaparecieron (siempre `rustls-platform-verifier`, el verificador del SO, el mismo que ya usaba `tauri-plugin-updater`). Nuestro reqwest y sentry (≥0.47 también sobre reqwest 0.13) van con **`rustls-no-provider`**, y el proveedor lo fija `main.rs::install_crypto_provider()` (`rustls::crypto::ring::default_provider().install_default()`) ANTES de `init_sentry()`, que construye su transporte en `init`. Sin esa llamada `ClientConfig::builder()` elige ring sólo porque es la única feature de proveedor en la unión del árbol; con aws-lc-rs presente y ninguno instalado, **todo cliente HTTPS hace panic en su primer request**. Nunca `reqwest/rustls` ni `sentry/rustls`; `cargo tree -i aws-lc-rs` debe estar vacío. No se activó `system-proxy` (default de 0.13): el 0.12 sin defaults sólo leía `HTTPS_PROXY` del entorno y eso se conserva; leer el proxy del registro de Windows sería un cambio silencioso.
- sentry 0.49: `ClientOptions` es `#[non_exhaustive]` — sólo builder (`ClientOptions::new().release(..)…`), el struct literal no compila. tungstenite 0.30: `Message::Text(Utf8Bytes)`/`Binary(Bytes)` → `Message::text(..)` y `Bytes::from(vec)` en `deepgram_provider.rs`.
- `nnnoiseless` con `default-features = false`: su `default = ["bin", "dasp"]` y `bin` arrastra clap 3 + hound para un binario que nunca se construye (el código sólo usa `DenoiseState`). `zip` y `dirs` en la misma major que tauri/updater/ffmpeg-sidecar; `winreg ≥0.55` para no anclar windows-sys 0.48. `[build-dependencies]` sólo `which`: `build.rs` no hace HTTP.
- **`frontend/scripts/lint-cargo-deps.js`** (pre-build, `cargo tree`, ~2-4 s) falla si reaparece una segunda versión de reqwest/rustls/tokio-rustls/hyper-rustls/rustls-native-certs/rustls-webpki/webpki-roots/zip/dirs/dirs-sys o si entran aws-lc-rs/clap/esaxx-rs/symphonia. Sólo local (CI llama `tauri build` directo). Pendiente fuera de #35: `windows 0.54/0.57/0.58/0.61` (cpal/sysinfo/nuestro WASAPI/tauri) y `windows-sys 0.59/0.60/0.61` siguen duplicados; `rand` ×4 lo ancla `phf_generator` (build-deps de html5ever), subir el nuestro no elimina versiones.

## Perfil de release en la raíz y features de GPU fijadas (sep-2026, #31 de la auditoría de recursos)

> Reglas de cumplimiento obligatorio al tocar un `Cargo.toml`, el skill `/build` o un workflow de CI.

**Cargo SOLO honra `[profile.*]` y `[patch.*]` del manifiesto RAÍZ del workspace** (`C:\maity_desktop\Cargo.toml`). Un bloque de esos en un miembro compila verde y sólo imprime `warning: profiles for the non root package will be ignored` en medio de un build de cinco minutos. Así vivieron ocho meses, desde el commit inicial `dbc1bc7` (herencia de Meetily):
- el `[profile.release]` de `llama-helper/Cargo.toml` (`lto = true`, `codegen-units = 1`, `opt-level = "s"`): nunca aplicó; los dos binarios salían con los defaults de Cargo (16 codegen-units, sin LTO; exe de 72 MB, NSIS de 26.5 MB);
- el `[patch.crates-io]` de cpal en `frontend/src-tauri/Cargo.toml` (fork `RustAudio/cpal@51c3b43` = master del 2025-02-16, sin release, versión 0.15.3 y `windows 0.54`): nunca entró a un binario; todo release 0.2.0..0.2.58 lleva cpal 0.15.3 de crates.io. Su único cambio con nombre es #946 (CoreAudio macOS, `supported_output_configs` en salidas no default); el resto son once meses de master sin probar con Maity. **Se retiró, no se activó**: cambiar el WASAPI real de Windows sin beneficio no tiene sentido; subir cpal a 0.16+ (trae #946; 0.18.2 exige rust 1.85 y `windows 0.62`) es una actualización aparte con smoke de captura y hot-swap.

**El perfil vigente**, en la raíz y para TODOS los miembros:

```toml
[profile.release]
lto = "thin"       # cross-crate y paralelo; "fat" = link monohilo sobre ~670 crates, riesgo de OOM (15 GB aquí, 16 GB en el runner)
codegen-units = 1
panic = "unwind"   # OBLIGATORIO: hooks de Sentry (main.rs) + logging/telemetry/panics.rs
```

- **Sin `strip`** (corrección al remedio de la auditoría, que pedía `strip = "symbols"`): en MSVC los símbolos viven en el `.pdb`, el exe no encoge; en macOS/Linux quita la tabla de símbolos y los stack traces de Sentry (`attach_stacktrace(true)`) quedan como direcciones. rustc lo desaconseja para apps con crash reporting.
- `opt-level` queda en 3 (default): RNNoise, EBU R128 y el resample corren en Rust puro. El `opt-level = "s"` que traía el helper nunca aplicó y no se reintrodujo (cero cambio de comportamiento).
- Coste: sólo la fase de cargo del build **release** (~1.3-1.6×). El build debug obligatorio de cada cambio no cambia. Al cambiar el perfil cambia el hash del helper → `node scripts/verify-helper-binary.js --fix` una vez.
- **Guard `frontend/scripts/lint-cargo-workspace.js`** (pre-build, parser de texto, <50 ms): falla si un miembro declara `[profile]`/`[patch]`, si la raíz pierde `lto` o `panic = "unwind"` o gana `strip = "symbols"`, o si un `.cargo/config.toml` declara `[profile]` (un config sobreescribe al manifiesto en silencio). Probado en rojo. Escape: `tauri:build:debug:skip-checks`.

**Features de GPU fijadas: CPU explícito en Windows/Linux, en todos los canales.**
- Hecho: todo release real (NSIS vía `/build`, MSIX vía `/store-msix`) se compila en la máquina de Julio, donde `auto-detect-gpu.js` ve `nvidia-smi` sin CUDA Toolkit y cae a CPU; el helper local se compila sin features. Los usuarios siempre han recibido whisper CPU + helper CPU. CI, en cambio, compilaba app y helper con `--features vulkan` en unos workflows y helper CPU en otros: artefactos divergentes que nadie smoke-testeaba, y con Vulkan `n_gpu_layers(999)` mete el modelo en la "VRAM" de la iGPU, que es RAM compartida invisible para el RSS del proceso.
- Regla: `/build` exporta `TAURI_GPU_FEATURE=none` (Windows) / `coreml` (macOS) en el comando; `tauri:build:store` llama `tauri build` directo (sin features); CI Windows/Linux sin `--features vulkan` en app y helper (Linux conserva `openblas`, que es CPU; macOS sigue `metal`/`coreml`: memoria unificada, ahí sí conviene). El auto-detect de `tauri-auto.js` queda sólo para `tauri:dev`; si la variable existe manda aunque esté vacía (`""` = CPU; antes caía en auto-detect por truthiness).
- Por qué: un build de producción no debe cambiar de backend porque alguien instaló un SDK (un CUDA instalado aquí produciría un exe que exige cuBLAS). whisper es motor opcional (Parakeet CPU es el default). Volver a GPU es decisión con A/B, como #33 (el de Parakeet + DirectML salió 2.3× más lento en iGPU).
- Helper: `MAITY_LLAMA_N_GPU_LAYERS` (default 999 = todas las que quepan; inválido → 999) fija `n_gpu_layers`; el sidecar no la toca, se hereda del proceso. Sólo actúa en un helper compilado con `metal|cuda|vulkan`; sirve para QA (`=0` fuerza CPU en macOS) y para el opt-in.
- Fuera de #31: los pasos de instalación del Vulkan SDK en CI quedan sin consumidor (no se tocaron: no se puede correr CI desde local); `Cargo.lock` sigue gitignored (cada máquina/CI resuelve de nuevo).
