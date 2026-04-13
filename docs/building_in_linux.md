# Compilar en Linux

Esta guia te ayuda a compilar Maity en Linux con **aceleracion GPU automatica**. El sistema de compilacion detecta tu hardware y configura el mejor rendimiento automaticamente.

> **Nota:** La aceleracion GPU aplica al sidecar `llama-helper` (inferencia local de LLM). La transcripcion (Parakeet/Canary) usa ONNX Runtime en CPU y no requiere configuracion GPU adicional.

---

## Inicio Rapido (Recomendado para Principiantes)

Si eres nuevo compilando en Linux, empieza aqui. Estos comandos simples funcionan para la mayoria de usuarios:

### 1. Instalar Dependencias Basicas

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install build-essential cmake git

# Fedora/RHEL
sudo dnf install gcc-c++ cmake git

# Arch Linux
sudo pacman -S base-devel cmake git
```

### 2. Compilar y Ejecutar

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

## Entendiendo la Auto-Deteccion

Los scripts de compilacion (`dev-gpu.sh` y `build-gpu.sh`) orquestan todo el proceso de compilacion. Primero llaman a `scripts/auto-detect-gpu.js` para identificar tu hardware, luego compilan el sidecar `llama-helper` con las features apropiadas, y finalmente lanzan la aplicacion Tauri.

### Prioridad de Deteccion

| Prioridad | Hardware        | Que Verifica                                                  | Resultado               |
| --------- | --------------- | ------------------------------------------------------------- | ----------------------- |
| 1         | **NVIDIA CUDA** | `nvidia-smi` existe + (`CUDA_PATH` o `nvcc` encontrado)      | `--features cuda`       |
| 2         | **AMD ROCm**    | `rocm-smi` existe + (`ROCM_PATH` o `hipcc` encontrado)       | `--features hipblas`    |
| 3         | **Vulkan**      | `vulkaninfo` existe + `VULKAN_SDK` + `BLAS_INCLUDE_DIRS` set | `--features vulkan`     |
| 4         | **OpenBLAS**    | `BLAS_INCLUDE_DIRS` configurado                               | `--features openblas`   |
| 5         | **Solo CPU**    | Ninguno de los anteriores                                     | (sin features, CPU puro)|

### Escenarios Comunes

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

## Guias de Configuracion de GPU (Intermedio)

Quieres mejor rendimiento? Sigue estas guias para habilitar aceleracion GPU.

### Configuracion NVIDIA CUDA

**Prerrequisitos:** GPU NVIDIA con compute capability 5.0+ (verificar: `nvidia-smi --query-gpu=compute_cap --format=csv`)

#### Paso 1: Instalar CUDA Toolkit

```bash
# Ubuntu/Debian (CUDA 12.x)
sudo apt install nvidia-driver-550 nvidia-cuda-toolkit

# Verificar instalacion
nvidia-smi          # Muestra info de GPU
nvcc --version      # Muestra version de CUDA
```

#### Paso 2: Compilar con CUDA

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

### Configuracion Vulkan (Alternativa Multiplataforma)

Vulkan funciona en GPUs NVIDIA, AMD e Intel. Buena opcion si CUDA/ROCm no funcionan.

#### Paso 1: Instalar Vulkan SDK y BLAS

```bash
# Ubuntu/Debian
sudo apt install vulkan-sdk libopenblas-dev

# Fedora
sudo dnf install vulkan-devel openblas-devel

# Arch Linux
sudo pacman -S vulkan-devel openblas
```

#### Paso 2: Configurar Entorno

```bash
# Agregar a ~/.bashrc o ~/.zshrc
export VULKAN_SDK=/usr
export BLAS_INCLUDE_DIRS=/usr/include/x86_64-linux-gnu

# Aplicar cambios
source ~/.bashrc
```

#### Paso 3: Compilar

```bash
./build-gpu.sh
```

El script detectara automaticamente Vulkan y compilara con `--features vulkan`.

---

### Configuracion AMD ROCm (Solo GPUs AMD)

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

## Uso Avanzado

### Sobreescritura Manual de Feature

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

### Ubicacion del Build de Salida

Despues de un build exitoso:

```
src-tauri/target/release/bundle/appimage/Maity_<version>_amd64.AppImage
```

---

## Solucion de Problemas

### "CUDA toolkit not found"

- **Solucion:** Instala `nvidia-cuda-toolkit` o configura la variable de entorno `CUDA_PATH`
- **Verificar:** `nvcc --version` deberia funcionar

### "Vulkan detected but missing dependencies"

- **Solucion:** Configura ambas variables de entorno `VULKAN_SDK` y `BLAS_INCLUDE_DIRS`
- **Ejemplo:**
  ```bash
  export VULKAN_SDK=/usr
  export BLAS_INCLUDE_DIRS=/usr/include/x86_64-linux-gnu
  ```

### "AppImage build stripping symbols"

- **Solucion:** Ya esta manejado! `build-gpu.sh` configura `NO_STRIP=true` automaticamente
- **Razon:** Previene errores en tiempo de ejecucion por simbolos faltantes

### El build funciona pero no hay aceleracion GPU

- **Verificar deteccion:** Revisa la salida del build para mensajes de deteccion de GPU
- **Verificar:** `nvidia-smi` (NVIDIA) o `rocm-smi` (AMD) deberian funcionar
- **SDK faltante:** Instala el toolkit de desarrollo, no solo los drivers

---

## Referencia Tecnica

### Matriz Completa de Features

| Modo     | Feature Flag          | Requisitos                                        | Aceleracion   | Mejora de Velocidad |
| -------- | --------------------- | ------------------------------------------------- | ------------- | ------------------- |
| CUDA     | `--features cuda`     | `nvidia-smi` + (`CUDA_PATH` o `nvcc`)             | GPU           | 5-10x               |
| ROCm     | `--features hipblas`  | `rocm-smi` + (`ROCM_PATH` o `hipcc`)              | GPU           | 4-8x                |
| Vulkan   | `--features vulkan`   | `vulkaninfo` + `VULKAN_SDK` + `BLAS_INCLUDE_DIRS` | GPU           | 3-6x                |
| OpenBLAS | `--features openblas` | `BLAS_INCLUDE_DIRS`                                | CPU optimizado| 1.5-2x              |
| CPU      | (ninguno)             | (ninguno)                                         | Solo CPU      | 1x (linea base)     |

### Internos de los Scripts de Compilacion

Tanto `dev-gpu.sh` como `build-gpu.sh` funcionan de la misma manera:

1. **Detectar ubicacion:** Encuentra `package.json` (funciona desde la raiz del proyecto o `frontend/`)
2. **Elegir gestor de paquetes:** Prefiere `pnpm`, alternativa `npm`
3. **Llamar script npm:** Ejecuta `tauri:dev` o `tauri:build`
4. **Auto-detectar GPU:** El script npm llama a `scripts/tauri-auto.js`
5. **Seleccion de feature:** `scripts/auto-detect-gpu.js` verifica el hardware
6. **Compilar con features:** Tauri compila con la flag `--features` detectada

### Referencia de Variables de Entorno

| Variable                          | Proposito                           | Ejemplo                         |
| --------------------------------- | ----------------------------------- | ------------------------------- |
| `CUDA_PATH`                       | Directorio de instalacion de CUDA   | `/usr/local/cuda`               |
| `ROCM_PATH`                       | Directorio de instalacion de ROCm   | `/opt/rocm`                     |
| `VULKAN_SDK`                      | Directorio del Vulkan SDK           | `/usr`                          |
| `BLAS_INCLUDE_DIRS`               | Ubicacion de headers BLAS           | `/usr/include/x86_64-linux-gnu` |
| `CMAKE_CUDA_ARCHITECTURES`        | Compute capability de la GPU        | `75` (para compute 7.5)         |
| `CMAKE_CUDA_STANDARD`             | Estandar C++ para CUDA              | `17`                            |
| `CMAKE_POSITION_INDEPENDENT_CODE` | Habilitar PIC para enlace           | `ON`                            |
| `NO_STRIP`                        | Prevenir strip de simbolos (AppImage)| `true`                         |

---

## Ejemplos Completos de Compilacion

### GPU NVIDIA (CUDA)

```bash
# Instalar
sudo apt install nvidia-driver-550 nvidia-cuda-toolkit

# Verificar
nvidia-smi --query-gpu=compute_cap --format=csv

# Compilar (ajustar arquitectura para tu GPU)
CMAKE_CUDA_ARCHITECTURES=86 \ # (86 puede cambiar en tu caso)
CMAKE_CUDA_STANDARD=17 \
CMAKE_POSITION_INDEPENDENT_CODE=ON \
./build-gpu.sh
```

### GPU AMD (ROCm)

```bash
# Instalar ROCm (ver documentacion de AMD para tu distro)
sudo apt install rocm-smi hipcc
export ROCM_PATH=/opt/rocm

# Compilar
./build-gpu.sh
```

### Cualquier GPU (Vulkan)

```bash
# Instalar
sudo apt install vulkan-sdk libopenblas-dev

# Configurar
export VULKAN_SDK=/usr
export BLAS_INCLUDE_DIRS=/usr/include/x86_64-linux-gnu

# Compilar
./build-gpu.sh
```

### Sin GPU (Solo CPU)

```bash
# Solo compila - funciona directamente
./build-gpu.sh
```

---

**Necesitas ayuda?** Abre un issue en GitHub con tu tipo de GPU, distribucion, y la salida de `./build-gpu.sh`.
