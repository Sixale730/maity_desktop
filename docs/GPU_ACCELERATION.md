# Guia de Aceleracion GPU

Maity soporta aceleracion GPU para inferencia de modelos locales de IA, lo cual puede mejorar significativamente el rendimiento. Esta guia proporciona informacion detallada sobre como configurar la aceleracion GPU en tu sistema.

> **Nota sobre transcripcion:** La transcripcion en Maity (Parakeet/Canary) utiliza ONNX Runtime en CPU y no requiere configuracion GPU adicional. La aceleracion GPU descrita en esta guia aplica al sidecar `llama-helper`, utilizado para inferencia local de LLM (resumenes, analisis de reuniones, etc.).

## Backends Soportados

El sidecar `llama-helper` soporta varios backends de aceleracion GPU:

*   **CUDA:** Para GPUs NVIDIA.
*   **Metal:** Para Apple Silicon y Macs modernos basados en Intel.
*   **Core ML:** Una capa de aceleracion adicional para Apple Silicon.
*   **Vulkan:** Una solucion multiplataforma para GPUs modernas de AMD e Intel.
*   **OpenBLAS:** Una optimizacion basada en CPU que puede proporcionar una mejora significativa de velocidad respecto al procesamiento CPU estandar.

## Deteccion Automatica de GPU

Los scripts de compilacion (`dev-gpu.sh`, `build-gpu.sh`) estan disenados para detectar automaticamente tu GPU y habilitar la feature flag apropiada durante el proceso de compilacion. La deteccion es manejada por el script `scripts/auto-detect-gpu.js`.

Esta es la prioridad de deteccion:

1.  **CUDA (NVIDIA)**
2.  **Metal (Apple)**
3.  **Vulkan (AMD/Intel)**
4.  **OpenBLAS (CPU)**

Si no se detecta GPU, la aplicacion usara procesamiento solo en CPU.

## Configuracion Manual

Si deseas configurar manualmente el backend de aceleracion GPU, puedes hacerlo habilitando la feature flag correspondiente en el archivo `frontend/src-tauri/Cargo.toml`.

Por ejemplo, para habilitar CUDA, modificarias la seccion `[features]` de la siguiente manera:

```toml
[features]
default = ["cuda"]

# ... otras features

cuda = ["whisper-rs/cuda"]
```

Luego, compilarias la aplicacion usando el comando estandar `pnpm tauri:build`.

## Instrucciones Especificas por Plataforma

### Linux

Para instrucciones detalladas sobre como configurar la aceleracion GPU en Linux, consulta las [instrucciones de compilacion en Linux](BUILDING.md).

### macOS

En macOS, la aceleracion GPU Metal esta habilitada por defecto. No se requiere configuracion adicional.

### Windows

Para habilitar la aceleracion GPU en Windows, necesitaras instalar el toolkit apropiado para tu GPU (por ejemplo, el CUDA Toolkit para GPUs NVIDIA) y luego compilar la aplicacion con la feature flag correspondiente habilitada.
