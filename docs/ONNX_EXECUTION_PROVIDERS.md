# Execution providers de ONNX Runtime en Maity (Parakeet / Moonshine / Canary)

**Estado (sep-2026): los tres motores ONNX corren en CPU en el build por defecto de Windows y
el exe ya no mapea `DirectML.dll`, `d3d12.dll`, `dxgi.dll` ni `dxcore.dll` al arrancar.**
GPU vía DirectML sigue disponible como opt-in de compilación (`--features onnx-directml`) para
Moonshine y Canary, o para cualquier modelo nuevo que la pida con `prefer_gpu: true`.

Este documento existe porque el hallazgo #33 de `AUDITORIA_RECURSOS_2026-09-02.md` tenía un
remedio que **no funcionaba** ("quitar el feature `directml`"), y porque la próxima vez que
alguien quiera "optimizar un modelo con GPU" tiene que saber qué palanca mueve qué cosa.

---

## 1. Las tres capas (y qué controla cada una)

| Capa | Dónde vive | Qué decide | Qué NO decide |
|---|---|---|---|
| **A. Prebuilt de ORT** (`ort-sys`, feature `download-binaries`) | `ort-sys-2.0.0-rc.10/dist.txt` + `build.rs` del crate; caché en `%LOCALAPPDATA%\ort.pyke.io\dfbin\<target>\<sha>\onnxruntime\lib\onnxruntime.lib` | **Qué código de ORT entra al exe.** Para `x86_64-pc-windows-msvc` solo hay cuatro filas: `none`, `cu12`, `wgpu`, `train`. **No existe variante `directml`**: la fila `none` (289 MB, estática, hash `540D19…`) ya trae el provider DML compilado (`Dml::DmlGraphFusionTransformer`, `DmlExecutionProvider`), y `static_link_prerequisites` enlaza `dxguid/DXCORE/DXGI/D3D12/DirectML` **incondicionalmente** en Windows. | Nada de lo que ponga la app en `[features]`. |
| **B. Feature de Cargo** `onnx-directml` (de la app) → `ort/directml` | `frontend/src-tauri/Cargo.toml` `[features]`; `audio/transcription/onnx_providers.rs` (`DIRECTML_COMPILED`, gate del `use` y del `push`, parámetro `directml_compiled` de `resolve_plan`) | **Si el código Rust puede registrar el EP.** Sin el feature, `DirectMLExecutionProvider::register()` no tiene cuerpo (devuelve `RegisterError::MissingFeature`) y `resolve_plan` ni lo pide: el plan es CPU y el log lo dice. | Qué DLLs importa el exe ni cuánto pesa (capa A). |
| **C. Delay-load** | `frontend/src-tauri/build.rs::configure_windows_delay_load` (`/DELAYLOAD:` de los 4 DLLs + `delayimp.lib` + `/IGNORE:4199`) | **Qué se mapea al arrancar.** Los cuatro DLLs pasan a la tabla de *delay imports*: el loader los carga en la PRIMERA llamada a una de sus funciones, que solo ocurre si un motor registra DML. Es lo mismo que hace ORT en su `onnxruntime.dll` (`cmake/onnxruntime_providers_dml.cmake`, `onnxruntime_ENABLE_DELAY_LOADING_WIN_DLLS`). | El tamaño del exe (el provider sigue dentro) ni si DML está disponible (capa B). |

Tabla de verdad (Windows, motor con `prefer_gpu: true`):

| `onnx-directml` | delay-load en `build.rs` | EP que obtiene el motor | DLLs de DirectX mapeados al arrancar | Tamaño del exe |
|---|---|---|---|---|
| off (**default**) | sí (**default**) | CPU | ninguno | igual |
| on | sí | DirectML (CPU si falla el registro) | ninguno; se cargan al crear la primera sesión DML | igual |
| off | no (estado hasta sep-2026, 0.2.58) | CPU | los 4, en todo arranque | igual |
| on | no (0.2.51–0.2.57) | DirectML | los 4, en todo arranque | igual |

Los "15-25 MB del exe" que estimaba el hallazgo **no se recuperan por ninguna combinación**:
exigirían un ORT sin `--use_dml` (§6).

## 2. Estado por motor

| Motor | `prefer_gpu` | Windows default | Windows `--features onnx-directml` | macOS | Por qué |
|---|---|---|---|---|---|
| **Parakeet** (default de producto; encoder, decoder_joint, nemo128) | `false` | CPU | CPU (el feature no manda; manda `prefer_gpu`) | CPU | A/B del 2026-07-20 (`AB_PARAKEET_EP_2026-07-20.md`): int8 sobre DML corría a RTF ~0.95 vs ~0.39 en CPU, con espirales de lag y drops por backpressure, sin ganancia de WER; además liberaba la VRAM que peleaba con el coach en GPUs de 4 GB. |
| **Moonshine** (opcional, selector en Ajustes) | `true` | CPU | DirectML | CoreML | Nunca se midió en DML. Sin usuarios que lo pidan hoy; solo admins pueden elegirlo (`ConfigContext` fuerza Parakeet al resto). |
| **Canary** (dev-only, opción solo admin) | `true` | CPU | DirectML | CoreML | Igual que Moonshine. Sus comandos SÍ están registrados en `lib.rs` (`canary_*`), al contrario de lo que decía CLAUDE.md hasta sep-2026. |

macOS es asimétrico a propósito: `ort/coreml` va siempre en el target macOS (`Cargo.toml`), CoreML es
un framework del sistema y solo lo piden Moonshine/Canary. No se tocó porque #33 es de Windows y
cambiar macOS sin medir sería otro remedio a ciegas.

## 3. Cómo se decide el EP en runtime

Todo pasa por `audio/transcription/onnx_providers.rs::build_session(model_path, OnnxSessionOpts)`:

```
build_session(opts)
  ├─ HardwareProfile::detect()             → cpu_cores, gpu_type (solo para el log)
  ├─ force_cpu()                           → MAITY_ONNX_FORCE_CPU=1|true
  ├─ resolve_plan(platform, prefer_gpu, forced_cpu, DIRECTML_COMPILED, disable_arena, cores)
  │     PURA y con tests: decide EpKind {DirectML | CoreML | Cpu}, parallel=false siempre,
  │     disable_memory_pattern = disable_arena || directml, intra_threads = (cores/2).clamp(2,4)
  ├─ providers = [ <EP de GPU si el plan lo pide> , CPU (siempre, siempre al final) ]
  └─ Session::builder().with_execution_providers(providers)…commit_from_file()
```

- `prefer_gpu` es una **petición del motor**, no una garantía. Parakeet pasa `false`; Moonshine y
  Canary `true`; el preprocessor mel (`nemo128`) `false` porque una sesión chica no amortiza el
  viaje CPU↔GPU.
- Dos fallbacks distintos de `ort`, y conviene no confundirlos: (1) si el EP **no registra**
  (feature ausente, DLL ausente, GPU sin DX12), ort sigue con el siguiente de la lista → CPU, sin
  romper; (2) si el EP registra pero **no soporta un operador**, ORT parte el grafo y ejecuta ese
  nodo en CPU con copias de memoria en cada frontera. El segundo caso "funciona" pero puede ser
  más lento que CPU puro; es una de las hipótesis del RTF 0.95 de Parakeet int8 en DML.
- Líneas de log a buscar (`%LOCALAPPDATA%\Maity\logs\maity.<fecha>.log`):
  - `ONNX[<label>] EP solicitado: <CPU|DirectML|CoreML> (gpu_detectada=…, force_cpu=…, directml_compilado=…, parallel=false, intra_threads=N)`
  - `ONNX[<label>] GPU solicitada pero DirectML no esta compilado (feature onnx-directml); usando CPU` — solo cuando un motor pidió GPU en un build sin el feature.
  - De ORT mismo cuando DML registra: `Successfully registered DmlExecutionProvider`, transformers `DmlGraphFusionTransformer`.
- DirectML exige ejecución **secuencial** y **memory pattern off**; el plan lo aplica solo.

## 4. Checklist: darle GPU a un modelo nuevo (o re-evaluar uno)

1. **Línea base en CPU primero.** Con el modelo cableado y `prefer_gpu: false`, grabar 3 min de
   audio conocido y medir RTF por chunk pareando `Processing speech audio chunk N` →
   `transcription complete for chunk N` (p50/p90/max; el A/B de julio usó un script `lat_ab.py`).
   RTF ≥ ~0.8 en tiempo real ya es zona de backpressure.
2. **`prefer_gpu: true`** en la llamada a `build_session` del motor (solo en las sesiones grandes;
   preprocessors chicos se quedan en `false`).
3. **Compilar con el feature**: `cd frontend && pnpm run tauri:build:debug -- --features onnx-directml`
   o `TAURI_GPU_FEATURE="vulkan,onnx-directml" pnpm run tauri:build:debug` (`tauri-auto.js` acepta
   la lista separada por comas). Verificación barata sin build completo:
   `cargo check -p maity-desktop --features onnx-directml` desde `frontend/src-tauri`.
   El `build.rs` imprime `cargo:warning=✅ Windows: DirectML EP … ENABLED` cuando va.
4. **A/B en la misma máquina y con el MISMO audio** (canal de sistema reproduciendo un video, como
   en julio): un run con `MAITY_ONNX_FORCE_CPU=1` y otro sin. Comparar RTF p50/p90, diff palabra a
   palabra, ráfagas de `ORT error` en el log, VRAM con `nvidia-smi` mientras el coach (llama-helper)
   está vivo, y `[METRIC] mem-sample`.
5. **Regla de decisión**: adoptar GPU solo si el RTF p90 mejora de forma clara **y** no hay pérdida
   de WER **y** no hay contención de VRAM con el coach en GPUs de 4 GB (incidente
   `parakeet_vram_contention_coach`, jul-2026: DML + gemma-3-4b = grabaciones que morían a los
   8-11 s). Escribir el resultado como `docs/AB_<MODELO>_<fecha>.md`, gane quien gane.
6. **Si el ganador es el motor por defecto**, decidir si `onnx-directml` entra en `default = [...]`
   del `Cargo.toml`. El delay-load sigue siendo correcto en ese caso (los DLLs se cargan al abrir
   la primera sesión, no al arrancar) y `lint-exe-imports.js` sigue pasando. Actualizar §2 de este
   doc y el blockquote de CLAUDE.md.

Gotchas que ya costaron tiempo:

- **int8 sobre DirectML puede ser más lento que CPU** (dequantize→float→requantize en operadores
  que DML no cubre). Si el modelo es int8, medir; no asumir.
- **Shapes dinámicos**: DML rinde mejor con tamaños fijos. `ort` ofrece
  `SessionBuilder::with_dimension_override("dim", n)`; nuestros motores reciben chunks de
  14k-78k muestras, así que habría que fijar un tamaño y rellenar.
- **Qué `DirectML.dll` se usaría depende del canal, y dev ≠ producción.** El prebuilt de pyke trae
  un `DirectML.dll` redistribuible de 17.7 MB y el feature `copy-dylibs` de `ort` (en sus defaults)
  lo copia a `target/debug/` (y `deps/`, `examples/`) junto al exe. En dev, por tanto, DML usaría
  ESE DLL (moderno); el **MSI** de Tauri lo recoge (`main.wxs` lo lista como componente) pero los
  canales que sí se embarcan, **NSIS** (`installer.nsi` no lo menciona) y **MSIX** (staging a
  mano), NO lo llevan: en producción Windows resuelve el de `System32` (presente desde 10 1903 =
  el `MinVersion 10.0.18362` del manifest), que puede ser más viejo que el que ORT 1.22 espera
  (≥1.15). Así corrió 0.2.51–0.2.57. Si algún día DML es el default: bundlear el redistribuible
  en NSIS y MSIX a propósito (licencia propia de Microsoft → `THIRD-PARTY-NOTICES.md`) o quitar
  `copy-dylibs` para que dev y producción prueben lo mismo. Con delay-load y el feature apagado
  nada de esto se toca hoy.
- **Con delay-load, un DLL ausente truena al primer uso, no al arrancar.** En el build por defecto
  es imposible (nadie registra DML). Con `onnx-directml` en una máquina sin `DirectML.dll`
  (LTSC/Server viejos) el fallo sería al abrir la sesión, no en el login. Antes de sep-2026 esa
  máquina directamente no arrancaba la app.
- **La VRAM no se libera "sola"**: Parakeet abre 3 sesiones; el reciclado periódico
  (`recycle_strategy`) recrea sesiones. Cualquier EP de GPU multiplica eso.

## 5. Verificar qué importa el exe

Guard automático: `frontend/scripts/lint-exe-imports.js` (parser PE en Node, sin dumpbin) corre en
`run-post-build-checks.js` después de cada `tauri:build:debug` y falla si alguno de los cuatro DLLs
vuelve a la tabla de imports de carga. `node scripts/lint-exe-imports.js --report` imprime ambas
tablas; `--exe <ruta>` para otro binario. Probado en rojo contra el exe de la 0.2.58 (09-09).

A mano, con el `dumpbin` del VS Build Tools (la ruta cambia con cada toolset):

```powershell
$d = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\dumpbin.exe"
& $d /nologo /dependents C:\maity_desktop\target\debug\maity-desktop.exe   # no deben aparecer directml/d3d12/dxcore/dxgi
& $d /nologo /imports    C:\maity_desktop\target\debug\maity-desktop.exe   # deben salir bajo "delay load imports"
```

En runtime (app abierta en login/idle):

```powershell
Get-Process maity-desktop | % Modules | ? ModuleName -match 'directml|d3d12|dxcore|dxgi'   # vacío
```

Si `dxgi.dll`/`d3d12.dll` aparecen igual, viene de OTRO camino (wry/WebView2 in-process, dwm), no
de ORT; se distingue porque `directml.dll` no estará y porque `--report` no los lista de carga.

## 6. Caminos NO tomados (y cuándo reabrirlos)

| Camino | Qué daría | Por qué no ahora |
|---|---|---|
| Prebuilt `cu12` (CUDA EP) | GPU NVIDIA con kernels nativos | Exige CUDA 12 + cuDNN 9 instalados por el usuario. Descartado en jul-2026 al diseñar `onnx_providers.rs`. |
| Prebuilt `wgpu` (WebGPU EP, ORT ≥1.22) | GPU en cualquier vendor vía Dawn, sin deps del usuario | Existe en `dist.txt` para Windows; enlaza `webgpu_dawn`. Sin medir. Candidato natural si algún día se quiere GPU sin DML. |
| `load-dynamic` + `onnxruntime.dll` **CPU-only oficial** de Microsoft | Única forma de recuperar los ~15-25 MB del exe: el runtime deja de ir estático y el DLL oficial CPU no trae DML | Cambia el modelo de despliegue: bundlear el DLL en NSIS (`bundle.resources`) **y** en el staging MSIX, `ort::init_from(path)` antes de la primera sesión, y una clase nueva de fallo ("DLL ausente") en el arranque. Esfuerzo M, riesgo en el camino crítico del producto. |
| `ORT_LIB_LOCATION` con un ORT compilado por nosotros sin `--use_dml` | Lo mismo, estático | CMake + ~1 h de build por plataforma y en CI. |
| Simetría en macOS (feature `onnx-coreml` opt-in) | Coherencia | CoreML es framework del sistema; sin medición del costo y fuera del alcance de #33. |

## 7. Historial

- **jun-2026, `666f976` (v0.2.51)**: se activa DirectML/CoreML para los tres motores vía
  `onnx_providers.rs` (Windows→DML, macOS→CoreML, CPU al final).
- **jul-2026**: contención de VRAM Parakeet-DML vs coach (gemma) en RTX 3050 4 GB → grabaciones
  que mueren a los 8-11 s; A/B del 20-jul → **Parakeet a CPU** (`prefer_gpu = false`), 2.3× más
  rápido y sin drops, WER idéntico. Moonshine/Canary conservan la petición de GPU.
- **sep-2026, #33 de la auditoría de recursos**: se verifica que el feature `directml` no controla
  el código enlazado; **delay-load** de los 4 DLLs en `build.rs`, feature `onnx-directml` **opt-in**
  (Windows default = CPU para los tres), guard `lint-exe-imports.js`, este documento.
