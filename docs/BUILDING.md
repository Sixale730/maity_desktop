# Compilar Maity desde el Codigo Fuente

Esta guia proporciona instrucciones detalladas para compilar Maity desde el codigo fuente en diferentes sistemas operativos.

<details>
<summary>Linux</summary>

## Compilar en Linux

Esta guia te ayuda a compilar Maity en Linux con **aceleracion GPU automatica**. El sistema de compilacion detecta tu hardware y configura el mejor rendimiento automaticamente.

> **Nota:** La aceleracion GPU aplica al sidecar `llama-helper` (inferencia local de LLM). La transcripcion (Parakeet/Canary) usa ONNX Runtime en CPU y no requiere configuracion GPU adicional.

---

### Inicio Rapido (Recomendado para Principiantes)

Si eres nuevo compilando en Linux, empieza aqui. Estos comandos simples funcionan para la mayoria de usuarios:

#### 1. Instalar Dependencias Basicas

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install build-essential cmake git

# Fedora/RHEL
sudo dnf install gcc-c++ cmake git

# Arch Linux
sudo pacman -S base-devel cmake git
```

#### 2. Compilar y Ejecutar

```bash
# Modo desarrollo (con hot reload)
./dev-gpu.sh

# Build de produccion
./build-gpu.sh
```

**Eso es todo!** Los scripts detectan automaticamente tu GPU y configuran la aceleracion.

### Que Sucede Automaticamente?

- **GPU NVIDIA** -> Aceleracion CUDA (si el toolkit esta instalado)
- **GPU AMD** -> Aceleracion ROCm (si ROCm esta instalado)
- **Sin GPU** -> Modo CPU optimizado (funciona igual de bien!)

> **Consejo:** Si tienes una GPU NVIDIA o AMD pero quieres mejor rendimiento, ve a la seccion de [Configuracion de GPU](#guias-de-configuracion-de-gpu-intermedio) mas abajo.

---

### Entendiendo la Auto-Deteccion

Los scripts de compilacion (`dev-gpu.sh` y `build-gpu.sh`) orquestan todo el proceso de compilacion. Asi es como funcionan:

1.  **Detectar ubicacion:** Encuentra `package.json` (funciona desde la raiz del proyecto o `frontend/`)
2.  **Auto-detectar GPU:** Ejecuta `scripts/auto-detect-gpu.js` (o usa `TAURI_GPU_FEATURE` si esta configurado)
3.  **Compilar Sidecar:** Compila `llama-helper` con la feature detectada (debug o release)
4.  **Copiar Binario:** Copia el sidecar compilado a `src-tauri/binaries` con el target triple
5.  **Ejecutar Tauri:** Llama a `npm run tauri:dev` o `tauri:build` con la feature flag pasada via variable de entorno

#### Prioridad de Deteccion

| Prioridad | Hardware        | Que Verifica                                                  | Resultado               |
| --------- | --------------- | ------------------------------------------------------------- | ----------------------- |
| 1         | **NVIDIA CUDA** | `nvidia-smi` existe + (`CUDA_PATH` o `nvcc` encontrado)      | `--features cuda`       |
| 2         | **AMD ROCm**    | `rocm-smi` existe + (`ROCM_PATH` o `hipcc` encontrado)       | `--features hipblas`    |
| 3         | **Vulkan**      | `vulkaninfo` existe + `VULKAN_SDK` + `BLAS_INCLUDE_DIRS` set | `--features vulkan`     |
| 4         | **OpenBLAS**    | `BLAS_INCLUDE_DIRS` configurado                               | `--features openblas`   |
| 5         | **Solo CPU**    | Ninguno de los anteriores                                     | (sin features, CPU puro)|

#### Escenarios Comunes

| Tu Sistema                     | Resultado de Auto-Deteccion      | Razon                              |
| ------------------------------ | -------------------------------- | ---------------------------------- |
| Instalacion limpia de Linux    | Solo CPU                         | No se detecto SDK de GPU           |
| GPU NVIDIA + solo drivers      | Solo CPU                         | CUDA toolkit no instalado          |
| GPU NVIDIA + CUDA toolkit      | **Aceleracion CUDA**             | Deteccion completa exitosa         |
| GPU AMD + ROCm                 | **Aceleracion HIPBlas**          | Deteccion completa exitosa         |
| Solo drivers Vulkan            | Solo CPU                         | Se necesitan Vulkan SDK + env vars |
| Vulkan SDK configurado         | **Aceleracion Vulkan**           | Todos los requisitos cumplidos     |

> **Dato clave:** Tener solo los drivers de GPU no es suficiente. Necesitas el **SDK de desarrollo** (CUDA toolkit, ROCm o Vulkan SDK) para la aceleracion.

---

### Guias de Configuracion de GPU (Intermedio)

Quieres mejor rendimiento? Sigue estas guias para habilitar aceleracion GPU.

#### Configuracion NVIDIA CUDA

**Prerrequisitos:** GPU NVIDIA con compute capability 5.0+ (verificar: `nvidia-smi --query-gpu=compute_cap --format=csv`)

##### Paso 1: Instalar CUDA Toolkit

```bash
# Ubuntu/Debian (CUDA 12.x)
sudo apt install nvidia-driver-550 nvidia-cuda-toolkit

# Verificar instalacion
nvidia-smi          # Muestra info de GPU
nvcc --version      # Muestra version de CUDA
```

##### Paso 2: Compilar con CUDA

```bash
# Configura la compute capability de tu GPU
# Ejemplo: RTX 3080 = 8.6 -> usa "86"
# Ejemplo: GTX 1080 = 6.1 -> usa "61"

CMAKE_CUDA_ARCHITECTURES=75 \
CMAKE_CUDA_STANDARD=17 \
CMAKE_POSITION_INDEPENDENT_CODE=ON \
./build-gpu.sh
```

> **Encontrar tu Compute Capability:**
>
> ```bash
> nvidia-smi --query-gpu=compute_cap --format=csv
> ```
>
> Convierte `7.5` -> `75`, `8.6` -> `86`, etc.

**Por que estos flags?**

- `CMAKE_CUDA_ARCHITECTURES`: Optimiza para tu GPU especifica
- `CMAKE_CUDA_STANDARD=17`: Asegura compatibilidad con C++17
- `CMAKE_POSITION_INDEPENDENT_CODE=ON`: Corrige problemas de enlace en sistemas modernos

---

#### Configuracion Vulkan (Alternativa Multiplataforma)

Vulkan funciona en GPUs NVIDIA, AMD e Intel. Buena opcion si CUDA/ROCm no funcionan.

##### Paso 1: Instalar Vulkan SDK y BLAS

```bash
# Ubuntu/Debian
sudo apt install vulkan-sdk libopenblas-dev

# Fedora
sudo dnf install vulkan-devel openblas-devel

# Arch Linux
sudo pacman -S vulkan-devel openblas
```

##### Paso 2: Configurar Entorno

```bash
# Agregar a ~/.bashrc o ~/.zshrc
export VULKAN_SDK=/usr
export BLAS_INCLUDE_DIRS=/usr/include/x86_64-linux-gnu

# Aplicar cambios
source ~/.bashrc
```

##### Paso 3: Compilar

```bash
./build-gpu.sh
```

El script detectara automaticamente Vulkan y compilara con `--features vulkan`.

---

#### Configuracion AMD ROCm (Solo GPUs AMD)

**Prerrequisitos:** GPU AMD con soporte ROCm (RX 5000+, Radeon VII, etc.)

```bash
# Ubuntu/Debian
# Agregar repositorio ROCm (ver https://rocm.docs.amd.com para lo mas reciente)
sudo apt install rocm-smi hipcc

# Configurar entorno
export ROCM_PATH=/opt/rocm

# Verificar
rocm-smi            # Muestra info de GPU
hipcc --version     # Muestra version de ROCm

# Compilar
./build-gpu.sh
```

---

### Uso Avanzado

#### Sobreescritura Manual de Feature

Quieres forzar un metodo de aceleracion especifico? Usa la variable de entorno `TAURI_GPU_FEATURE` con los scripts de shell:

```bash
# Forzar CUDA (ignorar auto-deteccion)
TAURI_GPU_FEATURE=cuda ./dev-gpu.sh
TAURI_GPU_FEATURE=cuda ./build-gpu.sh

# Forzar Vulkan
TAURI_GPU_FEATURE=vulkan ./dev-gpu.sh
TAURI_GPU_FEATURE=vulkan ./build-gpu.sh

# Forzar ROCm (HIPBlas)
TAURI_GPU_FEATURE=hipblas ./dev-gpu.sh
TAURI_GPU_FEATURE=hipblas ./build-gpu.sh

# Forzar solo CPU (para pruebas)
TAURI_GPU_FEATURE="" ./dev-gpu.sh
TAURI_GPU_FEATURE="" ./build-gpu.sh

# Forzar OpenBLAS (CPU optimizado)
TAURI_GPU_FEATURE=openblas ./dev-gpu.sh
TAURI_GPU_FEATURE=openblas ./build-gpu.sh
```

#### Ubicacion del Build de Salida

Despues de un build exitoso:

```
src-tauri/target/release/bundle/appimage/Maity_<version>_amd64.AppImage
```

---

### Solucion de Problemas

#### "CUDA toolkit not found"

- **Solucion:** Instala `nvidia-cuda-toolkit` o configura la variable de entorno `CUDA_PATH`
- **Verificar:** `nvcc --version` deberia funcionar

#### "Vulkan detected but missing dependencies"

- **Solucion:** Configura ambas variables de entorno `VULKAN_SDK` y `BLAS_INCLUDE_DIRS`
- **Ejemplo:**
  ```bash
  export VULKAN_SDK=/usr
  export BLAS_INCLUDE_DIRS=/usr/include/x86_64-linux-gnu
  ```

#### "AppImage build stripping symbols"

- **Solucion:** Ya esta manejado! `build-gpu.sh` configura `NO_STRIP=true` automaticamente
- **Razon:** Previene errores en tiempo de ejecucion por simbolos faltantes

#### El build funciona pero no hay aceleracion GPU

- **Verificar deteccion:** Revisa la salida del build para mensajes de deteccion de GPU
- **Verificar:** `nvidia-smi` (NVIDIA) o `rocm-smi` (AMD) deberian funcionar
- **SDK faltante:** Instala el toolkit de desarrollo, no solo los drivers

</details>

<details>
<summary>macOS</summary>

## Compilar en macOS

En macOS, el proceso de compilacion esta simplificado ya que la aceleracion GPU (Metal) esta habilitada por defecto.

### 1. Instalar Dependencias

```bash
# Instalar Homebrew (si no esta instalado)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Instalar herramientas requeridas
brew install cmake node pnpm
```

### 2. Compilar y Ejecutar

```bash
# Modo desarrollo (con hot reload)
pnpm tauri:dev

# Build de produccion
pnpm tauri:build
```

La aplicacion se compilara con aceleracion GPU Metal automaticamente.

</details>

<details>
<summary>Windows</summary>

## Compilar en Windows

### 1. Instalar Dependencias

- **Node.js:** Descargar e instalar desde [nodejs.org](https://nodejs.org/).
- **Rust:** Instalar desde [rust-lang.org](https://www.rust-lang.org/tools/install).
- **Visual Studio Build Tools:** Instalar la carga de trabajo "Desarrollo de escritorio con C++" desde el Visual Studio Installer.
- **CMake:** Descargar e instalar desde [cmake.org](https://cmake.org/download/).

### 2. Compilar y Ejecutar

```powershell
# Modo desarrollo (con hot reload)
pnpm tauri:dev

# Build de produccion
pnpm tauri:build
```

Por defecto, la aplicacion se compilara con procesamiento solo en CPU. Para habilitar aceleracion GPU, consulta la [Guia de Aceleracion GPU](docs/GPU_ACCELERATION.md).

</details>
