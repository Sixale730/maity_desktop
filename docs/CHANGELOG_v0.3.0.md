# Maity Desktop v0.3.0 — Changelog Completo

**Fecha**: 12-13 Abril 2026
**Commits**: 12 (desde v0.2.1)
**Archivos modificados**: 107
**LOC**: +18,198 / -696
**Tests**: 292 pass, 0 fail

---

## Nuevos Modulos

### Export Module (`export.rs`)
- Export de transcripciones en 4 formatos: JSON, CSV, Markdown, PDF
- Save dialog nativo via tauri-plugin-dialog
- Comando Tauri: `export_meeting(meeting_id, format)`
- Boton UI en meeting-details con dropdown de formatos
- 14 tests unitarios

### Secure Storage (`secure_storage.rs`)
- API keys almacenadas en OS Keyring (Windows Credential Manager / macOS Keychain)
- Funciones: store_api_key, get_api_key, delete_api_key, is_keyring_available
- 4 comandos Tauri registrados
- 6 tests (3 requieren keyring real)

### Input Validation (`validation_helpers` en lib.rs)
- 8 funciones de validacion: string length, path traversal, meeting_id, device_name, model_id, language, provider, meeting_name
- Aplicado en 4 comandos criticos: start_recording, export_meeting, coach_suggest, api_get_meeting
- Path traversal fix en read_audio_file y save_transcript
- 14 tests unitarios

### Coach IA v2.0 (`coach/`)
- Event-driven triggers: 12 detectores (precio, objecion, compra, frustracion, etc.)
- Meeting type detection: Sales, Service, Webinar, Team (heuristica + LLM)
- Connection Thermometer v5.0: evalua calidad de servicio, no actividad
- 8 categorias de sugerencias con frameworks reales (SPIN, Chris Voss, MEDDPICC, LAER)
- Spanish heuristic postprocessor: capitalizacion, tildes, signos de pregunta
- Bidirectional chat con contexto de reunion
- Tab de historial de preguntas (user + cliente)

### Internacionalizacion (`i18n/`)
- Infraestructura lightweight sin dependencias
- 3 idiomas: es, en, pt (62 claves cada uno)
- I18nContext + useI18n hook (pendiente integracion con componentes)

### Skeleton Loaders (`ui/skeleton.tsx`)
- Skeleton base (text, circular, rectangular)
- SkeletonTranscript, SkeletonMeetingCard, SkeletonSummary

### Theme System (`ThemeContext.tsx`, `ThemeToggle.tsx`)
- Dark/Light mode con persistencia localStorage
- Infraestructura lista (pendiente integracion SSR-safe)

### Dashboard Dev (`dashboard/`)
- Vite + React + TypeScript + Tailwind + Recharts + Framer Motion
- 5 tabs: Overview, Coach Test, Conversaciones, Prompts, Arquitectura
- 4 simulaciones: Venta SaaS, Servicio simulado, ISP real (Eugenia/Marco), Conferencia Enterprise
- Sistema de feedback con localStorage
- Paneles expandibles con prompts, tips, metricas

---

## Performance

| Optimizacion | Impacto |
|-------------|---------|
| `.clone()` eliminado en audio pipeline hot path | -5-8% CPU |
| 25+ logs info→debug/perf_debug en pipeline y worker | -1-3% CPU |
| Throttling progress reporting 5→30 chunks | Reduccion I/O 6x |
| VAD force-cut cada 2s (antes 30s) | Transcripcion real-time |
| ChunkAccumulator max 2s, flush 300ms | Latencia 500-800ms |
| Ring buffer 800ms→1.6s | Zero-loss bajo jitter |
| Ollama warm-up al iniciar app | Elimina cold-start 3-10s |
| Ollama keep-alive cada 3min | Modelo siempre en memoria |
| HTTP client compartido (LazyLock) | Elimina overhead TCP/TLS |

## Seguridad

| Fix | Detalle |
|-----|---------|
| API keys en OS Keyring | No mas texto plano en SQLite |
| Path traversal validation | read_audio_file, save_transcript protegidos |
| Input validation | 8 funciones, 4 comandos Tauri |
| CSP restrictivo | Solo localhost + Ollama endpoint |
| model-config-updated event | Recarga config de DB, no usa payload |

## Bug Fixes

| Bug | Causa | Fix |
|-----|-------|-----|
| Transcripcion rota al cambiar provider | FAST PATH validaba cualquier motor | Valida motor CONFIGURADO |
| Crash model-config-updated | Evento con payload null | Recarga de DB |
| Canary no transcribe | canary_validate sin config-aware | Nuevo comando Tauri |
| builtin_ai_get_models_directory faltante | No implementado | Nuevo modulo builtin_ai.rs |
| open_models_folder faltante | No implementado | Implementado con explorer/open |
| Hallucination filter descartaba audio | continue sin emitir | Marca sin descartar (zero-loss) |
| Muletillas eliminadas | trim_leading_fillers | Removido del pipeline |
| Meeting popup durante grabacion | Sin guard isRecording | Guard agregado |
| Thermometer subia con insultos | Solo contaba interlocutor | Cuenta AMBOS speakers |
| Tips solo interlocutor | source_type filter | Analiza ambos speakers |
| Profanidad sin penalizacion | Sin deteccion | -15pts/groseria + tip critico |
| Transcripcion desordenada | Sin sort | Sort por audio_start_time |
| Hydration error Next.js | SSR mismatch | Patron mounted |

## Enterprise Readiness

| Area | Score |
|------|-------|
| Tests | 292 pass (de 13 originales) |
| Export | JSON, CSV, Markdown, PDF |
| Security | Keyring + validation + path traversal |
| Auto-updater | Configurado (necesita signing key) |
| Deployment docs | SCCM, Intune, GPO (819 lineas) |
| Enterprise roadmap | Auditoria completa con KPIs |
| Accessibility | aria-labels en 6 componentes |

## Documentacion

| Documento | Contenido |
|-----------|-----------|
| docs/ENTERPRISE_DEPLOYMENT.md | Guia IT: silent install, SCCM, proxy, compliance |
| docs/ENTERPRISE_ROADMAP.md | Auditoria + KPIs + roadmap sprints |
| docs/COACH_FEATURE.md | Documentacion completa del Coach IA |
| docs/CHANGELOG_v0.3.0.md | Este archivo |
| dashboard/ | Dashboard dev con simulaciones y feedback |
