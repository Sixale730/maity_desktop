# Maity Desktop — Enterprise Roadmap

## Estado Actual: v0.2.1 (Abril 2026)

### Resultado de Auditoria Enterprise (Asamblea)

| Area | Score | Enterprise Ready? | Bloqueante? |
|------|-------|-------------------|-------------|
| Encriptacion de datos | 4/10 | NO | **SI** |
| Testing coverage | 1/10 | NO | **SI** |
| Auto-Updates | 0/10 | NO | **SI** |
| Export transcripciones | 0/10 | NO | **SI** |
| Error Handling | 6/10 | PARCIAL | NO |
| Logging | 8/10 | SI | NO |
| Onboarding | 7/10 | PARCIAL | NO |
| i18n | 3/10 | NO | NO (fase 2) |
| Accessibility | 3/10 | NO | NO (fase 2) |
| CI/CD | 9/10 | SI | NO |
| Privacy Policy | 8/10 | SI | NO |
| Installers | 9/10 | SI | NO |
| Code Signing (Win) | 9/10 | SI | NO |
| Documentacion | 5/10 | PARCIAL | NO |

---

## P0 — Bloqueantes Enterprise (Sprint 1)

### 1. Encriptacion de Datos Sensibles
- **Problema**: SQLite sin encriptar. API keys en texto plano.
- **Solucion**: SQLCipher + Windows Credential Manager / macOS Keychain
- **Archivos**: `database/manager.rs`, `Cargo.toml`
- **LOC**: ~200 | **Tests**: 5+

### 2. Export de Transcripciones
- **Problema**: No hay forma de exportar datos.
- **Solucion**: JSON, CSV, PDF, Markdown export
- **Archivos**: nuevo modulo `export/` + UI button en meeting-details
- **LOC**: ~550 | **Tests**: 8+

### 3. Auto-Updater
- **Problema**: `createUpdaterArtifacts: false`, no hay servidor de updates
- **Solucion**: Tauri updater + GitHub Releases + UI de notificacion
- **Archivos**: `tauri.conf.json`, `UpdateNotifier.tsx`
- **LOC**: ~250

### 4. Testing Coverage
- **Problema**: 13 tests unitarios en todo el codebase (~0.5%)
- **Target**: 100+ tests (40%+ coverage)
- **Prioridad**: database, audio pipeline, coach, export
- **LOC**: ~800 (tests)

---

## P1 — Alta Prioridad (Sprint 2)

### 5. Input Validation en Comandos Tauri
- Validar longitud, formato, caracteres en todos los `#[tauri::command]`
- **LOC**: ~150

### 6. Error Handling: Eliminar unwrap/expect
- Reemplazar en 65 archivos con `.map_err()` o `?`
- Prioridad: audio pipeline, recording manager, database
- **LOC**: ~300

### 7. Guia de Deployment Enterprise
- `docs/ENTERPRISE_DEPLOYMENT.md`
- Silent install MSI, SCCM, Intune, proxy config, model pre-distribution
- **LOC**: ~500 (documentacion)

### 8. Model Distribution Offline
- Bundling Parakeet (670MB) en MSI
- O: URL corporativa configurable para download
- **LOC**: ~200

---

## P2 — Mejoras (Sprint 3+)

### 9. Theme Switching (Light/Dark)
- CSS ya preparado, falta toggle + context provider
- **LOC**: ~100

### 10. Accessibility (WCAG 2.1 AA)
- aria-labels en 60+ componentes, keyboard nav, focus management
- **LOC**: ~400

### 11. Internacionalizacion (i18n)
- next-intl integration, JSON locale files
- Minimo: es, en, pt
- **LOC**: ~600

### 12. Skeleton Loaders
- Reemplazar spinners con skeleton UI
- meeting-details, transcript, summary
- **LOC**: ~200

---

## KPIs Enterprise

| KPI | Actual (v0.2.1) | Target (v1.0) |
|-----|-----------------|---------------|
| Test coverage | ~0.5% | >40% |
| Tests unitarios | 13 | 100+ |
| Vulnerabilidades criticas | 2 | 0 |
| Formatos de export | 0 | 4 |
| Auto-update | Deshabilitado | Habilitado + signed |
| WCAG compliance | ~10% | >60% |
| Idiomas UI | 1 (mixto) | 3 |
| Model offline install | No | Si |
| Enterprise docs | 0 pags | 5+ |

---

## Fortalezas Actuales (Listas para Enterprise)

1. **Privacidad**: 100% local-first, audio nunca sale del dispositivo
2. **CI/CD**: Workflows enterprise-grade, firma DigiCert, multi-plataforma
3. **Installers**: MSI + NSIS (Windows), DMG (macOS), AppImage (Linux)
4. **Logging**: Rotacion diaria, 7 dias retencion, tracing_subscriber
5. **Coach IA**: 8 categorias de sugerencias, frameworks reales (SPIN, Voss, MEDDPICC)
6. **Transcripcion**: Parakeet 3.45% WER, Canary 2.69% WER — state of art local
7. **Privacy Policy**: Documentada, transparente, analytics opt-in
