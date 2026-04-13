# Guía de Despliegue Empresarial — Maity Desktop

**Versión**: 0.2.0
**Última actualización**: 2026-04-12

Esta guía está dirigida a administradores de TI y equipos de operaciones que necesitan desplegar Maity Desktop en entornos corporativos. Cubre instalación silenciosa, distribución de modelos, configuración de proxy, seguridad y troubleshooting.

---

## 1. Requisitos del Sistema

### Hardware Mínimo

| Componente | Mínimo | Recomendado |
|---|---|---|
| **CPU** | Dual-core 2.0 GHz | Quad-core 2.4 GHz o superior |
| **RAM** | 4 GB | 8 GB o más |
| **Almacenamiento** | 2 GB libres (app) + 3-4 GB (modelos) | SSD, 10 GB libres |
| **Audio** | Micrófono integrado | Micrófono profesional + altavoces |
| **GPU** | Opcional | NVIDIA (CUDA), AMD (ROCm), Intel (Vulkan) |

### Sistemas Operativos Soportados

- **Windows**: Windows 10 (Build 19041+), Windows 11
- **macOS**: macOS 12+
- **Linux**: Ubuntu 20.04+, Fedora 35+, Arch Linux

### Dependencias Obligatorias

#### Windows
- Visual C++ Redistributable (MSVC 14.0+) — incluido en el instalador MSI
- .NET Runtime (opcional, no requerido para funcionalidad principal)

#### macOS
- Xcode Command Line Tools (incluido automáticamente en la primera ejecución)
- macOS 12 Monterey o superior

#### Linux
- ALSA (Advanced Linux Sound Architecture) o PulseAudio
- FFmpeg (para codificación de audio)
- Dependencias de desarrollo: `libssl-dev`, `libfontconfig1-dev`, `libudev-dev`

**Instalación de dependencias (Linux)**:

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y ffmpeg libssl-dev libfontconfig1-dev libudev-dev

# Fedora/RHEL
sudo dnf install -y ffmpeg openssl-devel fontconfig-devel systemd-devel

# Arch
sudo pacman -S ffmpeg openssl fontconfig
```

### Aceleración de GPU

La aceleración es **opcional** pero recomendada para mejorar rendimiento de transcripción:

- **NVIDIA**: CUDA Toolkit 11.8+ (solo drivers no es suficiente)
- **AMD**: ROCm 5.0+ (Linux) o drivers modernos (Windows)
- **Intel**: Vulkan SDK
- **macOS**: Metal (integrado, automático)

---

## 2. Instalación Silenciosa (MSI en Windows)

### Descarga del Instalador

Descarga el instalador MSI desde el repositorio de releases:

```
Maity_0.2.0_x64_en-US.msi  (~650 MB, incluye modelos Parakeet)
```

### Instalación Silenciosa Básica

```powershell
msiexec /i "Maity_0.2.0_x64_en-US.msi" /qn /norestart
```

**Parámetros**:
- `/i` : Instalar
- `/qn` : Sin UI (quiet, no interface)
- `/norestart` : No reiniciar (opcional)

### Instalación con Logging

Para diagnosticar problemas de instalación, habilita logging:

```powershell
msiexec /i "Maity_0.2.0_x64_en-US.msi" /qn /L*V "C:\Logs\maity_install.log"
```

Revisa el log en `C:\Logs\maity_install.log` si la instalación falla.

### Instalación en Ruta Personalizada

```powershell
msiexec /i "Maity_0.2.0_x64_en-US.msi" /qn INSTALLDIR="C:\Program Files\Maity"
```

### Desinstalación Silenciosa

```powershell
msiexec /x "Maity_0.2.0_x64_en-US.msi" /qn
```

### Integración con SCCM / Intune

#### Microsoft Endpoint Configuration Manager (SCCM)

1. **Preparar el paquete**:
   - Descarga el MSI
   - Coloca en un recurso compartido de red accesible: `\\server\share\maity\Maity_0.2.0_x64_en-US.msi`

2. **Crear aplicación en SCCM**:
   - **Nombre**: Maity Desktop 0.2.0
   - **Tipo**: Windows Installer (.msi)
   - **Ruta**: `\\server\share\maity\Maity_0.2.0_x64_en-US.msi`
   - **Programa de instalación**: `msiexec /i Maity_0.2.0_x64_en-US.msi /qn /norestart`
   - **Programa de desinstalación**: `msiexec /x Maity_0.2.0_x64_en-US.msi /qn`

3. **Implementar a colección de dispositivos**:
   - Seleccionar disponibilidad: **Requerida**
   - Plazo: Configurar según política corporativa (ej: 7 días)

#### Microsoft Intune

1. **Preparar el paquete**:
   - Carga el MSI a Intune como "Line-of-business app"
   - **Nombre**: Maity Desktop
   - **Descrición**: Asistente de reuniones con IA, grabación y transcripción local
   - **Información de editor**: Maity Inc.

2. **Configurar instalación**:
   - **Comando de instalación**: `msiexec /i Maity_0.2.0_x64_en-US.msi /qn /norestart`
   - **Directorio de instalación**: `C:\Program Files\Maity` (opcional)

3. **Asignar a grupos**:
   - Selecciona grupos de dispositivos o usuarios objetivo
   - Configura asignación como "Requerida"

### Plantilla de Group Policy (GPO)

Para entornos basados en Active Directory, crea una plantilla para controlar:

1. **Crear .ADMX personalizado** (ejemplo estructura):

```xml
<?xml version="1.0" encoding="utf-8"?>
<policyDefinitions xmlns="http://schemas.microsoft.com/GroupPolicy/2006/07/policy">
  <policyNamespaces>
    <target prefix="maity" namespace="Maity.Desktop" />
  </policyNamespaces>
  <resources minRequiredRevision="1.0" />
  <categories>
    <category name="Maity_Desktop" displayName="Maity Desktop" />
  </categories>
  <policies>
    <policy name="MaityAutoUpdate" class="Machine" displayName="Permitir actualizaciones automáticas" 
            explainText="Controla si Maity Desktop descarga e instala actualizaciones automáticamente">
      <parentCategory ref="Maity_Desktop" />
      <supportedOn ref="windows:SUPPORTED_WindowsAll" />
      <elements>
        <boolean id="AutoUpdateEnabled" defaultValue="true" />
      </elements>
      <string id="AutoUpdateEnabled">AutoUpdate</string>
    </policy>
  </policies>
</policyDefinitions>
```

2. **Copiar a SYSVOL**:
```powershell
Copy-Item -Path "maity.admx" -Destination "\\server\SYSVOL\domain\Policies\PolicyDefinitions\"
Copy-Item -Path "maity.adml" -Destination "\\server\SYSVOL\domain\Policies\PolicyDefinitions\es-ES\"
```

---

## 3. Instalación via NSIS

### Descarga del Instalador

```
Maity_0.2.0_x64-setup.exe  (~650 MB)
```

### Instalación Silenciosa Básica

```cmd
Maity_0.2.0_x64-setup.exe /S
```

### Instalación en Ruta Personalizada

```cmd
Maity_0.2.0_x64-setup.exe /S /D=C:\Program Files\Maity
```

### Instalación con Logging

```cmd
Maity_0.2.0_x64-setup.exe /S /D=C:\Program Files\Maity /NCRC
```

### Desinstalación

```cmd
C:\Program Files\Maity\Uninstall.exe /S
```

---

## 4. Distribución de Modelos

Maity Desktop descarga automáticamente los modelos de transcripción la primera vez que se usan. Para entornos corporativos con acceso limitado a internet o para acelerar el despliegue, **pre-distribuye los modelos** a las máquinas.

### Tamaño de Modelos

| Modelo | Tamaño | Ubicación |
|---|---|---|
| `parakeet-tdt-0.6b-v3-int8` | 670 MB | Requerido (default) |
| `canary-1b-flash-int8` | 939 MB | Opcional |
| **Total (ambos)** | **1.6 GB** | — |

### Ubicaciones de Almacenamiento

**Windows**:
```
%APPDATA%\com.maity.ai\models\
```

Ruta completa:
```
C:\Users\<username>\AppData\Roaming\com.maity.ai\models\
```

**macOS**:
```
~/Library/Application Support/com.maity.ai/models/
```

**Linux**:
```
~/.config/com.maity.ai/models/
```

### Estructura de Directorios

```
models/
├── parakeet-tdt-0.6b-v3-int8/
│   ├── model.onnx
│   └── vocab.txt
└── canary-1b-flash-int8/
    ├── encoder-model.int8.onnx
    ├── decoder-model.int8.onnx
    └── vocab.txt
```

### Script PowerShell de Pre-Distribución

Crea un script PowerShell para pre-distribuir modelos antes del primer uso:

```powershell
# pre-deploy-models.ps1
# Este script descarga y copia los modelos a la ruta local de Maity Desktop

param(
    [string]$ModelsSourcePath = "\\corporate\models\maity",  # Ubicación corporativa
    [string]$ModelType = "parakeet"  # parakeet o canary
)

# Validar que Maity está instalado
if (-not (Test-Path "C:\Program Files\Maity")) {
    Write-Error "Maity Desktop no está instalado. Instala primero: msiexec /i Maity_0.2.0_x64_en-US.msi /qn"
    exit 1
}

# Crear directorio de destino si no existe
$appDataPath = "$env:APPDATA\com.maity.ai\models"
if (-not (Test-Path $appDataPath)) {
    New-Item -ItemType Directory -Path $appDataPath -Force | Out-Null
    Write-Host "Creado directorio: $appDataPath"
}

# Copiar modelos según tipo
switch ($ModelType) {
    "parakeet" {
        $modelDir = "parakeet-tdt-0.6b-v3-int8"
        Write-Host "Descargando modelo Parakeet desde $ModelsSourcePath..."
        Copy-Item -Path "$ModelsSourcePath\$modelDir" -Destination "$appDataPath\" -Recurse -Force
        Write-Host "Modelo Parakeet copiado exitosamente"
    }
    "canary" {
        $modelDir = "canary-1b-flash-int8"
        Write-Host "Descargando modelo Canary desde $ModelsSourcePath..."
        Copy-Item -Path "$ModelsSourcePath\$modelDir" -Destination "$appDataPath\" -Recurse -Force
        Write-Host "Modelo Canary copiado exitosamente"
    }
    default {
        Write-Error "Tipo de modelo desconocido: $ModelType"
        exit 1
    }
}

Write-Host "Descarga de modelos completada"
exit 0
```

**Uso**:

```powershell
# Desplegar Parakeet
.\pre-deploy-models.ps1 -ModelsSourcePath "\\corporate\models\maity" -ModelType parakeet

# Desplegar Canary (opcional)
.\pre-deploy-models.ps1 -ModelsSourcePath "\\corporate\models\maity" -ModelType canary
```

### Descarga Centralizada via SCCM

Si usas SCCM, crea un paquete de "descarga de modelos":

1. **Preparar modelos en servidor corporativo**:
   ```
   \\corporate\models\maity\parakeet-tdt-0.6b-v3-int8\model.onnx (670MB)
   \\corporate\models\maity\parakeet-tdt-0.6b-v3-int8\vocab.txt
   ```

2. **Crear paquete SCCM**:
   - **Nombre**: Maity - Descargar modelos de transcripción
   - **Programa**: `powershell.exe -ExecutionPolicy Bypass -File pre-deploy-models.ps1 -ModelType parakeet`
   - **Ejecutar como**: Sistema local
   - **Ejecutar después de**: Paquete de instalación de Maity Desktop

---

## 5. Configuración de Proxy

Si la red corporativa bloquea acceso directo a internet, configura un proxy para descargas de modelos.

### Detección Automática (Recomendado)

Maity Desktop detecta automáticamente la configuración de proxy de Windows (WPAD/PAC). No requiere configuración manual en la mayoría de casos.

### Configuración Manual de Proxy

Si la detección automática falla, edita el archivo de configuración:

**Windows**:
```
%APPDATA%\com.maity.ai\config.toml
```

Agrega:

```toml
[network]
proxy_url = "http://proxy.empresa.com:8080"
proxy_username = "DOMAIN\username"  # Opcional
proxy_password = "password"          # Opcional (usar key segura en producción)
```

**macOS/Linux**:
```
~/.config/com.maity.ai/config.toml
```

### Whitelist de Dominios (Firewall)

Si tu firewall usa whitelist, asegúrate de permitir estos dominios:

- **HuggingFace** (descarga de modelos):
  - `huggingface.co`
  - `cdn-lfs.huggingface.co`
  - `*.huggingface.co`

- **Proveedores de LLM** (opcional, solo si usas resúmenes en nube):
  - `api.anthropic.com` (Claude)
  - `api.groq.com` (Groq)
  - `openrouter.ai` (OpenRouter)

- **Ollama** (si usas LLM local):
  - `localhost:11434` (interno, sin bloqueo)

### Puertos Obligatorios

- **HTTPS (443)**: Descargas de modelos
- **HTTP (80)**: Fallback (si HTTPS falla)
- **Puerto 11434**: Ollama local (si usas)

### Ejemplo: Proxy Corporativo con Autenticación

Si tu proxy requiere autenticación NTLM:

```toml
[network]
proxy_url = "http://proxy.empresa.com:8080"
proxy_auth_type = "ntlm"
proxy_username = "DOMAIN\username"
proxy_password = "password"
```

**Nota de Seguridad**: Usa credential managers del SO en lugar de almacenar contraseñas en texto plano. En Windows, puedes usar Windows Credential Manager:

```powershell
# Guardar credencial de proxy
cmdkey /add:proxy.empresa.com /user:DOMAIN\username /pass:password
```

---

## 6. Auto-Updates

Maity Desktop soporta actualizaciones automáticas.

### Control de Actualizaciones

#### Habilitar/Deshabilitar via GPO

```xml
<policy name="DisableAutoUpdate">
  <string>DisableAutoUpdate</string>
  <enabled />  <!-- Deshabilita actualizaciones automáticas -->
</policy>
```

#### Habilitar/Deshabilitar via Archivo de Configuración

**Windows**:
```toml
# %APPDATA%\com.maity.ai\config.toml
[updates]
enabled = false  # Deshabilitar actualizaciones automáticas
check_interval_hours = 24
```

### Staged Rollout

Si quieres desplegar actualizaciones gradualmente:

1. **Crear grupo de prueba** en SCCM:
   - 10-20% de usuarios (ej: "Maity_Pilot_Users")
   - Selecciona dispositivos piloto para testing

2. **Dejar que descargueen actualizaciones automáticamente** en grupo piloto durante 2-3 semanas

3. **Monitorear issues**:
   - Revisar logs de instalación en `C:\Programdata\Maity\logs\`
   - Recopilar feedback de usuarios piloto

4. **Desplegar a todos** si las pruebas pasaron exitosamente

### Monitoreo de Actualizaciones

**Revisar estado de actualización** en cada máquina:

```powershell
# Obtener versión instalada
(Get-Item "C:\Program Files\Maity\Maity.exe").VersionInfo.ProductVersion

# Ver logs de actualización
Get-Content "$env:APPDATA\com.maity.ai\logs\updates.log" -Tail 50
```

---

## 7. Seguridad y Compliance

### Encriptación de Datos

Maity Desktop almacena datos localmente en:
- **Grabaciones de audio**: `%APPDATA%\com.maity.ai\recordings\` (archivo .m4a, no encriptado por defecto)
- **Base de datos de transcripciones**: `%APPDATA%\com.maity.ai\maity.db` (SQLite, no encriptado por defecto)

#### Habilitar Encriptación de Base de Datos (Roadmap - Próximamente)

La encriptación con SQLCipher está planificada para futuras versiones. Para entornos altamente regulados, considera:

1. **Usar BitLocker** (Windows):
   ```powershell
   Enable-BitLocker -MountPoint "C:" -EncryptionMethod Aes256
   ```

2. **Usar FileVault** (macOS):
   ```bash
   sudo diskutil secureErase freespace 0 /dev/diskXsY
   ```

3. **Usar LUKS** (Linux):
   ```bash
   sudo cryptsetup luksFormat /dev/sdX
   ```

### Privacy y Compliance

#### Política de Datos

- **Audio**: Capturado localmente, almacenado en disco local, **nunca enviado a servidores externos** (excepto si el usuario elige un proveedor LLM en nube)
- **Transcripciones**: Guardadas localmente en SQLite
- **Resúmenes**: Generados localmente (Ollama) o enviados solo a proveedores seleccionados por el usuario (Claude, Groq, OpenRouter)
- **Identificación de hablantes**: Automática, basada en el canal de audio (micrófono = "usuario", sistema = "interlocutor")

#### Cumplimiento Regulatorio

**GDPR (Europa)**:
- Los datos se procesan y almacenan localmente en la máquina del usuario
- El usuario tiene control total sobre retención de datos
- No hay transferencia internacional de datos (por defecto)
- Implementación de "datos locales" cumple con principios GDPR

**HIPAA (Salud, USA)**:
- Requiere encriptación de datos en tránsito y en reposo
- Recomendación: Usar BitLocker + protectores de credentials del SO

**CCPA (California)**:
- El usuario puede solicitar y eliminar sus datos locales
- Maity Desktop no recopila datos de comportamiento del usuario

#### Certificados y Auditoría

- **No hay recolección de datos telemetría** (por defecto)
- **Logs locales**: Almacenados en `%APPDATA%\com.maity.ai\logs\`
- **Auditoría**: Habilita logs detallados via:
  ```toml
  # %APPDATA%\com.maity.ai\config.toml
  [logging]
  level = "debug"  # debug, info, warn, error
  ```

### Seguridad del Micrófono

- **Permisos**: Maity solicita permiso de micrófono al primera ejecución
- **Windows**: Usa APIs de permiso de Windows (WinRT)
- **macOS**: Requiere permiso de "Acceso a Micrófono" + "Grabación de Pantalla" (para audio del sistema)

---

## 8. Desinstalación y Limpieza

### Desinstalación Silenciosa

#### Windows (MSI)

```powershell
msiexec /x "Maity_0.2.0_x64_en-US.msi" /qn
```

#### Windows (NSIS)

```cmd
C:\Program Files\Maity\Uninstall.exe /S
```

### Remover Archivos de Datos y Configuración

**Nota**: Esto eliminará todas las grabaciones y transcripciones locales. Haz backup si es necesario.

#### Windows

```powershell
# Eliminar datos de usuario
Remove-Item -Path "$env:APPDATA\com.maity.ai" -Recurse -Force

# Eliminar accesos directos
Remove-Item -Path "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Maity*" -Force
```

#### macOS

```bash
# Eliminar aplicación
rm -rf /Applications/Maity.app

# Eliminar datos
rm -rf ~/Library/Application\ Support/com.maity.ai

# Eliminar cache
rm -rf ~/Library/Caches/com.maity.ai
```

#### Linux

```bash
# Eliminar datos
rm -rf ~/.config/com.maity.ai
rm -rf ~/.local/share/com.maity.ai
```

### Script de Limpieza Corporativa (PowerShell)

Para limpiar desinstalaciones en múltiples máquinas:

```powershell
# uninstall-maity.ps1
param(
    [bool]$RemoveData = $true  # Eliminar también datos locales
)

Write-Host "Desinstalando Maity Desktop..."

# Desinstalar app
msiexec /x "Maity_0.2.0_x64_en-US.msi" /qn /L*V "C:\Logs\maity_uninstall.log"

# Esperar a que el proceso termine
Start-Sleep -Seconds 5

if ($RemoveData) {
    Write-Host "Eliminando datos locales..."
    $appDataPath = "$env:APPDATA\com.maity.ai"
    if (Test-Path $appDataPath) {
        Remove-Item -Path $appDataPath -Recurse -Force
        Write-Host "Datos eliminados de: $appDataPath"
    }
}

Write-Host "Desinstalación completada"
exit 0
```

**Uso**:

```powershell
# Desinstalar + eliminar datos
.\uninstall-maity.ps1 -RemoveData $true

# Solo desinstalar, mantener datos
.\uninstall-maity.ps1 -RemoveData $false
```

---

## 9. Troubleshooting

### Problema: El Instalador Falla con Error 1603

**Causa**: Error genérico de MSI, generalmente por permisos o archivos bloqueados.

**Solución**:

1. **Ejecutar como Administrador**:
   ```powershell
   Start-Process msiexec -ArgumentList '/i "Maity_0.2.0_x64_en-US.msi" /qn' -Verb RunAs
   ```

2. **Revisar logs detallados**:
   ```powershell
   msiexec /i "Maity_0.2.0_x64_en-US.msi" /qn /L*V "C:\Logs\maity.log"
   ```

3. **Desinstalar completamente y reintentar**:
   ```powershell
   msiexec /x "Maity_0.2.0_x64_en-US.msi" /qn
   Start-Sleep -Seconds 10
   msiexec /i "Maity_0.2.0_x64_en-US.msi" /qn
   ```

### Problema: El Audio del Micrófono/Sistema No Se Captura

**Causa**: Falta de permisos de audio o dispositivos no configurados.

**Solución**:

1. **Verificar permisos** (Windows 10+):
   - Ir a: **Configuración → Privacidad y Seguridad → Micrófono**
   - Asegúrate que Maity está habilitado

2. **Verificar dispositivo de audio del sistema**:
   - **Windows**: Instalar una herramienta de loopback (ej: VB-Audio Virtual Cable, BlackHole)
   - **macOS**: BlackHole debe estar instalado (incluido en scripts de setup)

3. **Reiniciar servicio de audio**:
   ```powershell
   # Windows
   Restart-Service -Name "Windows Audio"
   
   # macOS
   sudo launchctl stop com.apple.audio.AudioComponentRegistrar
   sudo launchctl start com.apple.audio.AudioComponentRegistrar
   ```

### Problema: Descarga de Modelos Lenta o Falla

**Causa**: Conexión de red débil, proxy bloqueando, o CDN lenta.

**Solución**:

1. **Verificar conectividad**:
   ```powershell
   Test-NetConnection huggingface.co -Port 443
   ```

2. **Usar proxy corporativo**:
   ```toml
   # %APPDATA%\com.maity.ai\config.toml
   [network]
   proxy_url = "http://proxy.empresa.com:8080"
   timeout_seconds = 300  # Aumentar timeout
   ```

3. **Pre-distribuir modelos** (ver sección 4):
   - Copia manualmente modelos a `%APPDATA%\com.maity.ai\models\`

4. **Validar archivo descargado**:
   ```powershell
   # Verificar suma MD5 del modelo
   (Get-FileHash "C:\Users\user\AppData\Roaming\com.maity.ai\models\parakeet-tdt-0.6b-v3-int8\model.onnx" -Algorithm MD5).Hash
   ```

### Problema: Transcripción Muy Lenta (CPU Saturado)

**Causa**: CPU insuficiente, modelo demasiado pesado, o GPU no acelerada.

**Solución**:

1. **Verificar uso de CPU**:
   ```powershell
   # Ver procesos de Maity
   Get-Process | Where-Object { $_.ProcessName -like "*maity*" }
   ```

2. **Habilitar aceleración GPU** (si disponible):
   - Instalar drivers GPU (NVIDIA, AMD)
   - Reinstalar Maity con feature de GPU

3. **Reducir modelo** (no recomendado):
   - El modelo `parakeet-tdt-0.6b-v3-int8` es el más ligero disponible
   - Cambiar a CPU no mejora si ya está en CPU

### Problema: Base de Datos Corrupta

**Síntoma**: App se congela, error al abrir reuniones guardadas.

**Solución**:

1. **Hacer backup de base de datos**:
   ```powershell
   Copy-Item "$env:APPDATA\com.maity.ai\maity.db" "$env:APPDATA\com.maity.ai\maity.db.backup"
   ```

2. **Eliminar base de datos** (se recreará vacía):
   ```powershell
   Remove-Item "$env:APPDATA\com.maity.ai\maity.db" -Force
   ```

3. **Reiniciar Maity**:
   - Abrirá con base de datos nueva y vacía
   - Las transcripciones antiguas estarán en archivos de audio (`recordings/`)

### Problema: Maity No Inicia Después de Actualización

**Causa**: Actualización fallida, archivos corruptos.

**Solución**:

1. **Limpiar cache de aplicación**:
   ```powershell
   Remove-Item "$env:APPDATA\com.maity.ai\cache" -Recurse -Force
   ```

2. **Desinstalar y reinstalar**:
   ```powershell
   msiexec /x "Maity_0.2.0_x64_en-US.msi" /qn
   Start-Sleep -Seconds 10
   msiexec /i "Maity_0.2.0_x64_en-US.msi" /qn
   ```

3. **Revisar logs de error**:
   ```powershell
   Get-Content "$env:APPDATA\com.maity.ai\logs\*" -Tail 100
   ```

### Problema: Firewall Corporativo Bloquea Descarga de Modelos

**Síntoma**: "Network error" al descargar modelos, aunque hay internet.

**Solución**:

1. **Whitelist dominios** en firewall:
   - `huggingface.co`
   - `cdn-lfs.huggingface.co`

2. **Permitir puerto 443** (HTTPS):
   ```powershell
   # Ver reglas de firewall actuales
   Get-NetFirewallRule -DisplayName "*Maity*" -Direction Outbound
   
   # Crear regla (si no existe)
   New-NetFirewallRule -DisplayName "Maity Outbound HTTPS" -Direction Outbound -Action Allow `
     -Program "C:\Program Files\Maity\Maity.exe" -RemotePort 443 -Protocol TCP
   ```

3. **Usar proxy** (ver sección 5)

### Problema: Permisos de Acceso Insuficientes

**Síntoma**: "Permission Denied" al crear archivo de configuración.

**Solución**:

1. **Ejecutar como Administrador**:
   ```powershell
   Start-Process "C:\Program Files\Maity\Maity.exe" -Verb RunAs
   ```

2. **Reparar permisos de carpeta**:
   ```powershell
   # Tomar propiedad de carpeta Maity
   takeown /F "C:\Program Files\Maity" /R /D Y
   icacls "C:\Program Files\Maity" /grant:r "%username%:(F)" /T
   ```

---

## 10. Contacto Soporte Enterprise

Para consultas de despliegue corporativo, licenciamiento volumen, o soporte SLA:

- **Email**: enterprise@maity.ai
- **Teléfono**: +34 91 XXXX XXXX (España)
- **Portal de soporte**: https://support.maity.ai
- **Documentación**: https://docs.maity.ai

### Información para Reportar Issues

Cuando reportes un problema, incluye:

1. **Entorno**:
   ```powershell
   $ver = [System.Environment]::OSVersion.VersionString
   Write-Host "SO: $ver"
   Write-Host "Maity: $((Get-Item 'C:\Program Files\Maity\Maity.exe').VersionInfo.ProductVersion)"
   ```

2. **Logs**:
   - Ubicación: `%APPDATA%\com.maity.ai\logs\`
   - Enviar últimas 100 líneas de `app.log` y `error.log`

3. **Pasos para reproducir**:
   - Descripción clara del problema
   - Pasos exactos para reproducir

---

## Referencias Adicionales

- [README Principal](../README.md) — Requisitos generales
- [Documentación de Construcción](./BUILDING.md) — Compilar desde fuente
- [Pipeline de Transcripción](./TRANSCRIPTION_PIPELINE.md) — Detalles técnicos
- [Política de Privacidad](../PRIVACY_POLICY.md) — Datos y privacidad
- [CLAUDE.md](../CLAUDE.md) — Arquitectura técnica completa

---

**Documento preparado para administradores de TI. Para retroalimentación o correcciones, contacta al equipo de documentación.**
