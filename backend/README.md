# Maity Backend

Backend FastAPI para almacenamiento de reuniones y analisis con IA. Incluye un sistema de distribucion Docker para despliegue sencillo.

## Tabla de Contenidos
- [Notas Importantes](#notas-importantes)
- [Inicio Rapido](#inicio-rapido)
- [Despliegue con Docker (Recomendado)](#despliegue-con-docker-recomendado)
- [Desarrollo Nativo](#desarrollo-nativo)
- [Instalacion Manual](#instalacion-manual)
- [Documentacion de la API](#documentacion-de-la-api)
- [Solucion de Problemas](#solucion-de-problemas)
- [Referencia Completa de Scripts](#referencia-completa-de-scripts)

---

## Notas Importantes

### Requisitos de Procesamiento de Audio (Servidor Whisper Legacy)

> **Nota**: El servidor Whisper es un componente legacy/opcional. Maity Desktop ahora utiliza motores de transcripcion integrados (Parakeet y Canary, basados en ONNX) directamente en la aplicacion de escritorio. El servidor Whisper solo es necesario si se desea usar la transcripcion por servidor separado.

Cuando se ejecuta en contenedores Docker, el procesamiento de audio puede perder fragmentos debido a limitaciones de recursos:

**Sintomas:**
- Mensajes en los logs: "Dropped old audio chunk X due to queue overflow"
- Transcripciones incompletas o faltantes
- Retrasos en el procesamiento

**Prevencion:**
- Asignar **8GB+ de RAM** a los contenedores Docker
- Asegurar asignacion adecuada de CPU
- Usar un tamano de modelo Whisper apropiado para tu hardware
- Monitorear el uso de recursos del contenedor

---

## Inicio Rapido

Elige tu metodo de despliegue preferido:

### Opcion 1: Docker (Recomendado - Mas Facil)
```bash
# Navegar al directorio backend
cd backend

# Windows (PowerShell)
.\build-docker.ps1 cpu
.\run-docker.ps1 start -Interactive

# macOS/Linux (Bash)
./build-docker.sh cpu
./run-docker.sh start --interactive
```

### Opcion 2: Desarrollo Nativo (Mejor Rendimiento)
```bash
# Navegar al directorio backend
cd backend

# Windows - Instalar dependencias primero, luego compilar
.\install_dependancies_for_windows.ps1  # Ejecutar como Administrador
build_whisper.cmd small
start_with_output.ps1

# macOS/Linux
./build_whisper.sh small
./clean_start_backend.sh
```

**Despues del inicio, acceder a:**
- **Servidor Whisper (Legacy)**: http://localhost:8178
- **Aplicacion de Reuniones**: http://localhost:5167 (con documentacion de la API en `/docs`)

---

## Despliegue con Docker (Recomendado)

Docker proporciona la configuracion mas sencilla con gestion automatica de dependencias, deteccion de GPU y compatibilidad multiplataforma.

### Requisitos Previos
- Docker Desktop (Windows/Mac) o Docker Engine (Linux)
- 8GB+ de RAM asignados a Docker
- Para GPU: Controladores NVIDIA + nvidia-container-toolkit

### Windows (PowerShell)

#### Configuracion Basica
```powershell
# Construir imagenes
.\build-docker.ps1 cpu

# Configuracion interactiva (recomendado para usuarios nuevos)
.\run-docker.ps1 start -Interactive

# Inicio rapido con valores por defecto
.\run-docker.ps1 start -Detach
```

#### Configuracion Avanzada
```powershell
# Aceleracion GPU
.\build-docker.ps1 gpu
.\run-docker.ps1 start -Model large-v3 -Gpu -Language en -Detach

# Puertos y funcionalidades personalizadas
.\run-docker.ps1 start -Port 8081 -AppPort 5168 -Translate -Diarize

# Monitorear servicios
.\run-docker.ps1 logs -Service whisper -Follow
.\run-docker.ps1 status
```

### macOS/Linux (Bash)

#### Configuracion Basica
```bash
# Construir imagenes
./build-docker.sh cpu

# Configuracion interactiva (recomendado)
./run-docker.sh start --interactive

# Inicio rapido con valores por defecto
./run-docker.sh start --detach
```

#### Configuracion Avanzada
```bash
# Con modelo e idioma especificos
./run-docker.sh start --model base --language es --detach

# Ver logs y estado
./run-docker.sh logs --service whisper --follow
./run-docker.sh status

# Migracion de base de datos desde instalacion existente
./run-docker.sh setup-db --auto
```

### Funcionalidades del Modo Interactivo

El modo interactivo te guia a traves de:

1. **Seleccion de Modelo** - Elige entre 20+ modelos con orientacion sobre tamano/precision
2. **Configuracion de Idioma** - Selecciona entre 40+ idiomas soportados
3. **Configuracion de Puertos** - Deteccion automatica de conflictos y resolucion
4. **Configuracion de Base de Datos** - Migrar desde instalaciones existentes o iniciar nueva
5. **Configuracion de GPU** - Auto-deteccion y configuracion
6. **Funcionalidades Avanzadas** - Traduccion, diarizacion, barra de progreso
7. **Persistencia de Configuracion** - Guarda preferencias para futuras ejecuciones

### Guia de Tamanos de Modelo (Whisper Legacy)

| Modelo | Tamano | Precision | Velocidad | Mejor Para |
|--------|--------|-----------|-----------|------------|
| tiny | ~39 MB | Basica | Mas rapida | Pruebas, recursos limitados |
| base | ~142 MB | Buena | Rapida | Uso general (recomendado) |
| small | ~244 MB | Mejor | Media | Cuando se necesita mejor precision |
| medium | ~769 MB | Alta | Lenta | Requisitos de alta precision |
| large-v3 | ~1550 MB | Optima | Mas lenta | Maxima precision |

> **Nota**: Para transcripcion local en la aplicacion de escritorio, Maity utiliza Parakeet (por defecto, ~670MB) o Canary (opcional, ~939MB), ambos basados en ONNX.

### Comparacion Docker vs Nativo

| Aspecto | Docker | Nativo |
|---------|--------|--------|
| **Configuracion** | Facil (automatizada) | Manual (requiere dependencias) |
| **Rendimiento** | Bueno (5-10% de overhead) | Optimo (acceso directo al hardware) |
| **Soporte GPU** | Solo NVIDIA | Soporte nativo completo |
| **Aislamiento** | Completo | Entorno compartido |
| **Portabilidad** | Universal | Especifico por plataforma |
| **Actualizaciones** | Reemplazo de contenedor | Actualizaciones manuales |

---

## Desarrollo Nativo

El despliegue nativo ofrece rendimiento optimo al ejecutarse directamente en el sistema anfitrion.

### Requisitos Previos

#### Windows
- Python 3.8+ (en PATH)
- Visual Studio Build Tools (carga de trabajo C++)
- CMake
- Git
- PowerShell 5.0+

#### macOS
- Xcode Command Line Tools: `xcode-select --install`
- Homebrew: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- Python 3.8+: `brew install python3`
- Dependencias: `brew install cmake llvm libomp`

### Configuracion en Windows

**Opcion 1: Release Pre-compilado (Recomendado - Mas Facil)**

La forma mas sencilla y rapida de comenzar es usando el release pre-compilado del backend:

**Requisitos previos:**
- No se requieren dependencias adicionales

**Pasos de instalacion:**
1. Descargar el archivo zip mas reciente del backend desde [releases](https://github.com/ponchovillalobos/maity-desktop/releases/latest)
2. Extraer en una carpeta (ej., `C:\maity_backend\`)
3. Abrir PowerShell y navegar a la carpeta extraida
4. Desbloquear todos los archivos (requisito de seguridad de Windows):
   ```powershell
   Get-ChildItem -Path . -Recurse | Unblock-File
   ```
5. Iniciar el backend:
   ```powershell
   .\start_with_output.ps1
   ```

**Que incluye:**
- Binario `whisper-server.exe` pre-compilado (legacy)
- Aplicacion Python completa con entorno virtual
- Todas las dependencias requeridas pre-instaladas
- Descarga automatica de modelos y configuracion
- Seleccion interactiva de modelo e idioma

**Funcionalidades:**
- Descarga automatica de whisper-server.exe desde releases de GitHub si no esta presente
- Seleccion interactiva de modelo (tiny a large-v3)
- Seleccion de idioma (40+ idiomas soportados)
- Configuracion de puertos con deteccion de conflictos
- Configuracion de entorno virtual e instalacion de dependencias
- Opcion para descargar e instalar la aplicacion frontend

El script te guiara a traves de la configuracion e iniciara tanto el servidor Whisper (puerto 8178, legacy) como la aplicacion de reuniones (puerto 5167) automaticamente.

**Opcion 2: Configuracion con Docker (Alternativa - Mas Facil)**

Docker maneja todas las dependencias automaticamente:

```powershell
# Navegar al directorio backend
cd backend

# Construir e iniciar (version CPU)
.\build-docker.ps1 cpu
.\run-docker.ps1 start -Interactive
```

**Requisitos previos:**
- Docker Desktop instalado
- 8GB+ de RAM asignados a Docker

**Opcion 3: Build Local (Mejor Rendimiento)**

Para rendimiento optimo, compilar localmente despues de instalar dependencias:

**Dependencias Requeridas (Instalar Primero):**
- **Python 3.9+** con pip (agregar a PATH)
- **Visual Studio Build Tools** (carga de trabajo C++)
- **CMake** (agregar a PATH)
- **Git** (con soporte de submodulos)
- **Visual Studio Redistributables**

**Paso 1: Instalar Dependencias**
```powershell
# Ejecutar instalador de dependencias (como Administrador)
Set-ExecutionPolicy Bypass -Scope Process -Force
.\install_dependancies_for_windows.ps1
```
*Nota: Esto tarda 15-30 minutos e instala todas las herramientas requeridas*

**Paso 2: Compilar Whisper**
```cmd
# Compilar whisper.cpp con modelo (ej., 'small', 'base.en', 'large-v3')
build_whisper.cmd small

# Iniciar servicios interactivamente
start_with_output.ps1

# Alternativa: Inicio limpio
clean_start_backend.cmd
```

**Proceso de Build:**
1. Actualiza submodulos git (`whisper.cpp`)
2. Copia archivos personalizados del servidor desde `whisper-custom/server/`
3. Compila whisper.cpp usando CMake + Visual Studio
4. Crea entorno virtual Python en `venv/`
5. Instala dependencias desde `requirements.txt`
6. Descarga el modelo Whisper especificado
7. Crea `whisper-server-package/` con todos los archivos

**Detalles de Instalacion de Dependencias:**
El script `install_dependancies_for_windows.ps1` instala:
- Gestor de paquetes Chocolatey
- Python 3.11 (si no esta presente)
- Visual Studio Build Tools 2022 con carga de trabajo C++
- CMake con integracion a PATH
- Git con soporte de submodulos
- Visual Studio Redistributables
- Herramientas de desarrollo (bun, si es necesario)

### Configuracion en macOS

```bash
# Navegar al directorio backend
cd backend

# Compilar whisper.cpp con modelo
./build_whisper.sh small

# Iniciar servicios
./clean_start_backend.sh
```

**Optimizaciones para macOS:**
- Aceleracion OpenMP con `libomp`
- Optimizaciones del compilador LLVM para Apple Silicon
- Deteccion automatica de M1/M2 vs Intel
- Asignacion optimizada de hilos para nucleos de Apple Silicon

### URLs de Servicios
- **Servidor Whisper (Legacy)**: http://localhost:8178
  - Salud: `GET /`
  - Transcripcion: `POST /inference`
  - WebSocket: `ws://localhost:8178/`
- **Aplicacion de Reuniones**: http://localhost:5167
  - Documentacion de la API: http://localhost:5167/docs
  - Salud: `GET /get-meetings`
  - WebSocket: `ws://localhost:5167/ws`

---

## Instalacion Manual

Si prefieres control manual completo sobre el proceso de instalacion.

### Requisitos del Sistema
- Python 3.9+
- FFmpeg
- Compilador C++ (Visual Studio Build Tools/Xcode)
- CMake
- Git (con soporte de submodulos)
- Ollama (para funcionalidades LLM locales)
- ChromaDB
- Claves de API (Claude/Groq) si se usan LLMs externos

### Instalacion Paso a Paso

#### 1. Instalar Dependencias del Sistema

**Windows:**
```cmd
# Python 3.9+ desde Python.org (agregar a PATH)
# Visual Studio Build Tools (carga de trabajo Desktop C++)
# CMake desde CMake.org (agregar a PATH)
# FFmpeg (descargar o: choco install ffmpeg)
# Git desde Git-scm.com
# Ollama desde Ollama.com
```

**macOS:**
```bash
# Instalar Homebrew si no esta instalado
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Instalar dependencias
brew install python@3.9 cmake llvm libomp ffmpeg git ollama
```

#### 2. Instalar Dependencias de Python
```bash
# Windows
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

# macOS
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt
```

#### 3. Compilar Servidor Whisper (Legacy)
```bash
# Windows
./build_whisper.cmd

# macOS (dar permisos si es necesario)
chmod +x build_whisper.sh
./build_whisper.sh
```

#### 4. Iniciar Servicios
```bash
# Windows
./start_with_output.ps1

# macOS
chmod +x clean_start_backend.sh
./clean_start_backend.sh
```

---

## Documentacion de la API

Una vez que los servicios estan ejecutandose:
- **Swagger UI**: http://localhost:5167/docs
- **ReDoc**: http://localhost:5167/redoc

### Servicios Principales

1. **Servidor Whisper.cpp (Legacy)** (Puerto 8178)
   - Transcripcion de audio en tiempo real
   - Soporte WebSocket para streaming
   - Soporte para multiples modelos
   - **Nota**: La aplicacion de escritorio Maity ahora usa Parakeet/Canary integrados para transcripcion local

2. **Backend FastAPI** (Puerto 5167)
   - APIs de gestion de reuniones
   - Integracion con LLM (Ollama local, Claude, Groq, OpenRouter)
   - Almacenamiento y consulta de datos
   - WebSocket para actualizaciones en tiempo real

---

## Solucion de Problemas

### Problemas Comunes con Docker

**Conflictos de Puertos:**
```bash
# Detener servicios
./run-docker.sh stop  # o .\run-docker.ps1 stop

# Verificar uso de puertos
netstat -an | grep :8178
lsof -i :8178  # macOS/Linux
```

**GPU No Detectada (Windows):**
- Habilitar integracion WSL2 en Docker Desktop
- Instalar nvidia-container-toolkit
- Verificar con: `.\run-docker.ps1 gpu-test`

**Fallos en Descarga de Modelos:**
```bash
# Descarga manual
./run-docker.sh models download base.en
# o
.\run-docker.ps1 models download base.en
```

### Problemas Comunes Nativos

**Problemas de Build en Windows:**
```cmd
# CMake no encontrado - instalar Visual Studio Build Tools
# Ejecucion de PowerShell bloqueada:
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
```

**Problemas de Build en macOS:**
```bash
# Errores de compilacion
brew install cmake llvm libomp
export CC=/opt/homebrew/bin/clang
export CXX=/opt/homebrew/bin/clang++

# Permiso denegado
chmod +x build_whisper.sh
chmod +x clean_start_backend.sh

# Conflictos de puertos
lsof -i :5167  # Encontrar proceso usando el puerto
kill -9 PID   # Terminar proceso
```

### Problemas Generales

**Los Servicios No Inician:**
1. Verificar que los puertos 8178 (Whisper legacy) y 5167 (Backend) estan disponibles
2. Verificar que todas las dependencias estan instaladas
3. Revisar logs para mensajes de error especificos
4. Asegurar recursos de sistema suficientes (8GB+ de RAM recomendados)

**Problemas con Modelos:**
- Verificar conexion a internet para descarga de modelos
- Verificar espacio en disco disponible (los modelos pueden ser 1.5GB+)
- Validar nombres de modelos contra la lista soportada

---

## Referencia Completa de Scripts

### Scripts de Docker

#### build-docker.ps1 / build-docker.sh
Construir imagenes Docker con soporte de GPU y compatibilidad multiplataforma.

**Uso:**
```bash
# Tipos de Build
cpu, gpu, macos, both, test-gpu

# Opciones
-Registry/-r REGISTRY    # Registro Docker
-Push/-p                 # Enviar al registro
-Tag/-t TAG             # Etiqueta personalizada
-Platforms PLATFORMS    # Plataformas destino
-BuildArgs ARGS         # Argumentos de build
-NoCache/--no-cache     # Construir sin cache
-DryRun/--dry-run       # Solo mostrar comandos
```

**Ejemplos:**
```bash
# Builds basicos
.\build-docker.ps1 cpu
./build-docker.sh gpu

# Multi-plataforma con registro
.\build-docker.ps1 both -Registry "ghcr.io/user" -Push
./build-docker.sh cpu --platforms "linux/amd64,linux/arm64" --push
```

#### run-docker.ps1 / run-docker.sh
Gestor de despliegue Docker completo con configuracion interactiva.

**Comandos:**
```bash
start, stop, restart, logs, status, shell, clean, build, models, gpu-test, setup-db, compose
```

**Opciones de Inicio:**
```bash
-Model/-m MODEL         # Modelo Whisper (por defecto: base.en)
-Port/-p PORT          # Puerto Whisper (por defecto: 8178)
-AppPort/--app-port    # Puerto de la app de reuniones (por defecto: 5167)
-Gpu/-g/--gpu          # Forzar modo GPU
-Cpu/-c/--cpu          # Forzar modo CPU
-Language/--language   # Codigo de idioma (por defecto: auto)
-Translate/--translate # Habilitar traduccion
-Diarize/--diarize     # Habilitar diarizacion
-Detach/-d/--detach    # Ejecutar en segundo plano
-Interactive/-i        # Configuracion interactiva
```

**Ejemplos:**
```bash
# Configuracion interactiva
.\run-docker.ps1 start -Interactive
./run-docker.sh start --interactive

# Configuracion avanzada
.\run-docker.ps1 start -Model large-v3 -Gpu -Language es -Detach
./run-docker.sh start --model base --translate --diarize --detach

# Gestion
.\run-docker.ps1 logs -Service whisper -Follow
./run-docker.sh logs --service app --follow --lines 100
```

### Scripts Nativos

#### build_whisper.cmd / build_whisper.sh
Compilar el servidor whisper.cpp con modificaciones personalizadas.

**Uso:**
```bash
build_whisper.cmd [NOMBRE_MODELO]    # Windows
./build_whisper.sh [NOMBRE_MODELO]   # macOS/Linux
```

**Modelos Disponibles:**
```
tiny, tiny.en, base, base.en, small, small.en, medium, medium.en,
large-v1, large-v2, large-v3, large-v3-turbo,
*-q5_1 (cuantizado 5 bits), *-q8_0 (cuantizado 8 bits)
```

### Variables de Entorno

**Configuracion de Servicios:**
```bash
WHISPER_MODEL=base.en          # Modelo por defecto
WHISPER_PORT=8178              # Puerto Whisper
APP_PORT=5167                  # Puerto de la app
WHISPER_LANGUAGE=auto          # Idioma
WHISPER_TRANSLATE=false        # Traduccion
WHISPER_DIARIZE=false          # Diarizacion
```

**Configuracion de Build:**
```bash
REGISTRY=ghcr.io/user          # Registro Docker
PUSH=true                      # Enviar al registro
PLATFORMS=linux/amd64          # Plataformas destino
FORCE_GPU=true                 # Forzar modo GPU
DEBUG=true                     # Salida de depuracion
```

### Migracion de Base de Datos

**Fuentes Soportadas:**
- Instalaciones existentes de Homebrew
- Rutas manuales de archivos de base de datos
- Auto-descubrimiento en ubicaciones comunes
- Instalacion nueva (crea nueva base de datos)

**Rutas de Auto-Descubrimiento (macOS/Linux):**
```
/opt/homebrew/Cellar/meetily-backend/*/backend/meeting_minutes.db
$HOME/.meetily/meeting_minutes.db
$HOME/Documents/meetily/meeting_minutes.db
$HOME/Desktop/meeting_minutes.db
./meeting_minutes.db
$SCRIPT_DIR/data/meeting_minutes.db
```

### Funcionalidades Avanzadas

**Resolucion de Conflictos de Puertos:**
- Deteccion automatica de conflictos de puertos
- Opcion de terminar procesos que usan los puertos requeridos
- Sugerencia de puertos alternativos
- Validacion de disponibilidad de puertos

**Deteccion de GPU:**
- Deteccion automatica de GPU NVIDIA
- Verificacion de soporte GPU en Docker
- Fallback a modo CPU cuando GPU no esta disponible
- Funcionalidad de prueba de GPU

**Gestion de Modelos:**
- Descarga automatica de modelos
- Estimacion de tamano y barra de progreso
- Cache local de modelos
- Validacion e integridad de modelos

**Configuracion Interactiva:**
- Seleccion de modelo con orientacion
- Seleccion de idioma (40+ idiomas)
- Asistencia en migracion de base de datos
- Persistencia y reutilizacion de configuracion
- Validacion de configuracion

Esta guia completa cubre todas las opciones de despliegue y proporciona instrucciones claras para ejecutar el backend de Maity en cualquier entorno.
