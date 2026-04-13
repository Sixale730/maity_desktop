# Maity - Frontend

Aplicacion de escritorio moderna para grabar, transcribir y analizar reuniones con asistencia de IA. Construida con Next.js y Tauri para una experiencia de escritorio nativa.

## Caracteristicas

- Grabacion de audio en tiempo real desde microfono y audio del sistema
- Transcripcion en vivo usando Parakeet (ONNX, por defecto) o Canary (ONNX, opcional) - completamente local
- Integracion nativa de escritorio con Tauri 2.x
- Grabacion stereo dual-canal (L=microfono, R=sistema)
- Editor de texto enriquecido para tomar notas
- Enfocado en privacidad: todo el procesamiento ocurre localmente

## Requisitos Previos

### Para macOS:
- Node.js (v18 o posterior)
- Rust (ultima version estable)
- pnpm (v8 o posterior)
- [Xcode Command Line Tools](https://developer.apple.com/download/all/?q=xcode)

### Para Windows:
- Node.js (v18 o posterior)
- Rust (ultima version estable)
- pnpm (v8 o posterior)
- Visual Studio Build Tools con herramientas de desarrollo C++
- Windows 10 o posterior

## Estructura del Proyecto

```
/frontend
├── src/                   # Codigo frontend Next.js/React/TypeScript
├── src-tauri/             # Backend Rust para Tauri
│   ├── src/audio/         # Pipeline de audio, VAD, grabacion
│   ├── src/parakeet_engine/ # Motor de transcripcion Parakeet (ONNX)
│   ├── src/canary_engine/ # Motor de transcripcion Canary (ONNX)
│   └── src/database/      # Base de datos SQLite local
├── public/                # Recursos estaticos
└── package.json           # Dependencias del proyecto
```

## Instalacion

### Para macOS:

1. Instalar requisitos previos:
   ```bash
   # Instalar Homebrew si no esta instalado
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

   # Instalar Node.js
   brew install node

   # Instalar Rust
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

   # Instalar pnpm
   npm install -g pnpm

   # Instalar Xcode Command Line Tools
   xcode-select --install
   ```

2. Clonar el repositorio y navegar al directorio frontend:
   ```bash
   git clone https://github.com/ponchovillalobos/maity-desktop
   cd maity-desktop/frontend
   ```

3. Instalar dependencias:
   ```bash
   pnpm install
   ```

### Para Windows:

1. Instalar requisitos previos:
   - Instalar [Node.js](https://nodejs.org/) (v18 o posterior)
   - Instalar [Rust](https://www.rust-lang.org/tools/install)
   - Instalar pnpm: `npm install -g pnpm`
   - Instalar [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) con herramientas de desarrollo C++

2. Clonar el repositorio y navegar al directorio frontend:
   ```cmd
   git clone https://github.com/ponchovillalobos/maity-desktop
   cd maity-desktop/frontend
   ```

3. Instalar dependencias:
   ```cmd
   pnpm install
   ```

## Ejecutar la Aplicacion

### Para macOS:

Usar el script proporcionado para ejecutar la app en modo desarrollo:
```bash
./clean_run.sh
```

Para compilar una version de produccion:
```bash
./clean_build.sh
```

Puedes especificar el nivel de log (info, debug, trace):
```bash
./clean_run.sh debug
```

### Para Windows:

Usar el script proporcionado para ejecutar la app en modo desarrollo:
```cmd
clean_run_windows.bat
```

Para compilar una version de produccion:
```cmd
clean_build_windows.bat
```

## Desarrollo

### Frontend (Next.js)
- El frontend esta construido con Next.js y Tailwind CSS
- El codigo fuente esta en el directorio `src/`
- Para ejecutar solo el frontend: `pnpm run dev`

### Backend (Tauri/Rust)
- El backend Rust esta en el directorio `src-tauri/`
- Maneja la captura de audio, acceso al sistema de archivos e integraciones nativas
- Incluye los motores de transcripcion Parakeet y Canary (ONNX)
- Para ejecutar el servidor de desarrollo Tauri completo: `pnpm run tauri dev`

### Builds Especificos por GPU
```bash
pnpm run tauri:dev:metal    # macOS Metal GPU
pnpm run tauri:dev:cuda     # NVIDIA CUDA
pnpm run tauri:dev:vulkan   # AMD/Intel Vulkan
pnpm run tauri:dev:cpu      # Solo CPU (sin GPU)
```

### Motores de Transcripcion

**Parakeet (Por Defecto)**
- Modelo: `parakeet-tdt-0.6b-v3-int8` (~670MB)
- Arquitectura: Transducer (TDT) basado en ONNX
- Rendimiento: 3.45% WER en espanol en CPU
- Se inicializa automaticamente al inicio de la aplicacion

**Canary (Opcional)**
- Modelo: `canary-1b-flash-int8` (~939MB)
- Arquitectura: Encoder-decoder (autoregresivo) basado en ONNX
- Rendimiento: 2.69% WER en espanol (MLS)
- Se inicializa solo si esta seleccionado en la configuracion
- Idiomas soportados: en, es, de, fr

## Solucion de Problemas

### Problemas Comunes en macOS
- Si encuentras problemas de permisos con los scripts, hacerlos ejecutables:
  ```bash
  chmod +x clean_run.sh clean_build.sh
  ```
- Para problemas de acceso al microfono, asegurar que la app tenga permisos de microfono en Preferencias del Sistema
- Para captura de audio del sistema, se requiere permiso de grabacion de pantalla y un dispositivo de audio virtual (ej., BlackHole)

### Problemas Comunes en Windows
- Si encuentras errores de build, asegurar que Visual Studio Build Tools estan correctamente instalados con la carga de trabajo C++
- Para problemas de captura de audio, verificar la configuracion de privacidad de Windows para acceso al microfono
- Si la app falla al iniciar, intentar ejecutar el Command Prompt como administrador
- Para aceleracion GPU, asegurar que los drivers NVIDIA (CUDA) o AMD/Intel (Vulkan) estan actualizados

## Contribuir

1. Hacer fork del repositorio
2. Crear tu rama de funcionalidad (`git checkout -b feat/funcionalidad-nueva`)
3. Hacer commit de tus cambios (`git commit -m 'feat: agregar funcionalidad nueva'`)
4. Hacer push a la rama (`git push origin feat/funcionalidad-nueva`)
5. Abrir un Pull Request

## Repositorio

https://github.com/ponchovillalobos/maity-desktop

## Licencia

Este proyecto esta licenciado bajo la Licencia MIT - ver el archivo LICENSE para mas detalles.
