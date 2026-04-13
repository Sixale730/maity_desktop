// ============================================================
// Maity Desktop — Development Metrics Data
// Update this file after each improvement cycle
// ============================================================

export interface Cycle {
  id: number;
  date: string;
  title: string;
  description: string;
  filesChanged: number;
  loc: number;
  testsAdded: number;
  testsPassed: number;
  testsFailed: number;
  buildStatus: 'pass' | 'fail' | 'pending';
  category: 'framework' | 'feature' | 'optimization' | 'ui' | 'refactor';
}

export interface TestModule {
  name: string;
  module: string;
  total: number;
  passed: number;
  failed: number;
  category: 'coach' | 'transcription' | 'audio' | 'postprocess' | 'other';
}

export interface BuildSnapshot {
  date: string;
  version: string;
  exeSize: number; // MB
  msiSize: number; // MB
  buildTime: number; // minutes
  warnings: number;
  testsTotal: number;
  exitCode: number;
}

export interface ImprovementCandidate {
  title: string;
  priority: 'high' | 'medium' | 'low' | 'future';
  impact: string;
  locEstimate: number;
  status: 'pending' | 'in-progress' | 'done' | 'deferred';
  prerequisite?: string;
}

export interface TranscriptionProvider {
  name: string;
  model: string;
  size: string;
  wer: number; // Word Error Rate % on Spanish
  status: 'active' | 'disabled' | 'optional';
  license: string;
}

export interface SessionSummary {
  date: string;
  cyclesCompleted: number;
  totalLoc: number;
  totalTests: number;
  highlights: string[];
}

// ============================================================
// DATA
// ============================================================

export const projectInfo = {
  name: 'Maity Desktop',
  version: '0.3.0',
  description: 'Asistente de reuniones con IA, privacidad local',
  stack: 'Tauri 2.x + Next.js 14 + Rust + Python',
  repo: 'github.com/ponchovillalobos/maity-desktop',
  startDate: '2026-04-11',
  lastUpdate: '2026-04-12',
};

export const cycles: Cycle[] = [
  {
    id: 0,
    date: '2026-04-11',
    title: 'Framework Setup',
    description: 'Multi-agent framework, memory system, CLAUDE.md rules (sections 9-11)',
    filesChanged: 8,
    loc: 900,
    testsAdded: 0,
    testsPassed: 0,
    testsFailed: 0,
    buildStatus: 'pass',
    category: 'framework',
  },
  {
    id: 1,
    date: '2026-04-11',
    title: 'Coach Phase 1 + Spanish Heuristic',
    description: 'Backend coach_suggest, coach_set_model, coach_get_status + spanish_postprocess.rs',
    filesChanged: 5,
    loc: 570,
    testsAdded: 13,
    testsPassed: 13,
    testsFailed: 0,
    buildStatus: 'pass',
    category: 'feature',
  },
  {
    id: 2,
    date: '2026-04-11',
    title: 'Coach Phase 2 (UI Frontend)',
    description: 'CoachContext.tsx, CoachPanel.tsx, panel lateral 320px, integrado en page.tsx',
    filesChanged: 4,
    loc: 460,
    testsAdded: 0,
    testsPassed: 13,
    testsFailed: 0,
    buildStatus: 'pass',
    category: 'ui',
  },
  {
    id: 3,
    date: '2026-04-11',
    title: 'VAD Tuning + Anti-Stutter + Evaluator',
    description: 'VAD threshold tuning, anti-stutter dedup in worker.rs, transcript evaluator',
    filesChanged: 2,
    loc: 330,
    testsAdded: 11,
    testsPassed: 24,
    testsFailed: 0,
    buildStatus: 'pass',
    category: 'optimization',
  },
  {
    id: 4,
    date: '2026-04-11',
    title: 'Coach Phases A+B+D',
    description: 'DB context persistence, bidirectional chat, meeting history integration',
    filesChanged: 3,
    loc: 520,
    testsAdded: 10,
    testsPassed: 34,
    testsFailed: 0,
    buildStatus: 'pass',
    category: 'feature',
  },
  {
    id: 6,
    date: '2026-04-12',
    title: 'Coach v2.0 — Triggers & Meeting Type',
    description: 'Event-driven triggers, meeting type detection, connection thermometer, 8 suggestion categories',
    filesChanged: 4,
    loc: 1450,
    testsAdded: 33,
    testsPassed: 33,
    testsFailed: 0,
    buildStatus: 'pass',
    category: 'feature',
  },
];

export const testModules: TestModule[] = [
  { name: 'Coach Commands', module: 'coach::commands', total: 14, passed: 14, failed: 0, category: 'coach' },
  { name: 'Coach Triggers', module: 'coach::trigger', total: 13, passed: 13, failed: 0, category: 'coach' },
  { name: 'Coach Meeting Type', module: 'coach::meeting_type', total: 6, passed: 6, failed: 0, category: 'coach' },
  { name: 'Spanish Postprocess', module: 'spanish_postprocess', total: 18, passed: 18, failed: 0, category: 'postprocess' },
  { name: 'Database Models', module: 'database::models', total: 15, passed: 15, failed: 0, category: 'other' },
  { name: 'Database Settings', module: 'database::repositories::setting', total: 12, passed: 12, failed: 0, category: 'other' },
  { name: 'Database Transcript Chunks', module: 'database::repositories::transcript_chunk', total: 15, passed: 15, failed: 0, category: 'other' },
  { name: 'Database Summary', module: 'database::repositories::summary', total: 16, passed: 16, failed: 0, category: 'other' },
  { name: 'Database Setup', module: 'database::setup', total: 9, passed: 9, failed: 0, category: 'other' },
  { name: 'Summary Processor', module: 'summary::processor', total: 28, passed: 28, failed: 0, category: 'other' },
  { name: 'Audio Pipeline', module: 'audio::pipeline', total: 13, passed: 13, failed: 0, category: 'audio' },
  { name: 'VAD Processor', module: 'audio::vad', total: 12, passed: 12, failed: 0, category: 'audio' },
  { name: 'Onboarding', module: 'onboarding', total: 6, passed: 6, failed: 0, category: 'other' },
  { name: 'Validation Helpers', module: 'validation_helpers', total: 14, passed: 14, failed: 0, category: 'other' },
  { name: 'Export Module', module: 'export', total: 14, passed: 14, failed: 0, category: 'other' },
  { name: 'Secure Storage', module: 'secure_storage', total: 6, passed: 3, failed: 0, category: 'other' },
];

export const buildSnapshots: BuildSnapshot[] = [
  {
    date: '2026-04-11',
    version: '0.2.0',
    exeSize: 55.2,
    msiSize: 31.2,
    buildTime: 5.5,
    warnings: 1,
    testsTotal: 18,
    exitCode: 0,
  },
  {
    date: '2026-04-11',
    version: '0.2.0',
    exeSize: 55.4,
    msiSize: 31.3,
    buildTime: 4.2,
    warnings: 1,
    testsTotal: 24,
    exitCode: 0,
  },
  {
    date: '2026-04-11',
    version: '0.2.0',
    exeSize: 55.6,
    msiSize: 31.4,
    buildTime: 6.1,
    warnings: 1,
    testsTotal: 34,
    exitCode: 0,
  },
  {
    date: '2026-04-12',
    version: '0.2.1',
    exeSize: 56.1,
    msiSize: 31.8,
    buildTime: 7.3,
    warnings: 1,
    testsTotal: 51,
    exitCode: 0,
  },
  {
    date: '2026-04-12',
    version: '0.3.0',
    exeSize: 55.0,
    msiSize: 31.0,
    buildTime: 9.3,
    warnings: 2,
    testsTotal: 291,
    exitCode: 0,
  },
];

export const improvementCandidates: ImprovementCandidate[] = [
  {
    title: 'Moonshine ASR Engine',
    priority: 'high',
    impact: '+4 idiomas, menor latencia',
    locEstimate: 2200,
    status: 'pending',
    prerequisite: 'Cargo deps + UI selector',
  },
  {
    title: 'DirectML GPU (Windows)',
    priority: 'medium',
    impact: '2-3x speedup en Windows',
    locEstimate: 100,
    status: 'pending',
    prerequisite: 'Feature flag en Cargo.toml',
  },
  {
    title: 'Batch Audio Metrics Processor',
    priority: 'medium',
    impact: 'Dashboards de audio real-time',
    locEstimate: 150,
    status: 'pending',
    prerequisite: 'Recording pipeline refactor',
  },
  {
    title: 'Rotating File Logger',
    priority: 'low',
    impact: 'Mejor logging dev/prod',
    locEstimate: 80,
    status: 'pending',
    prerequisite: 'Cargo logger integration',
  },
  {
    title: 'Coach Memory Persistence (Phases C/E/F)',
    priority: 'future',
    impact: 'RAG + encryption + advanced UI',
    locEstimate: 400,
    status: 'pending',
    prerequisite: 'coach_memory SQLite table + RAG',
  },
];

export const transcriptionProviders: TranscriptionProvider[] = [
  {
    name: 'Parakeet',
    model: 'parakeet-tdt-0.6b-v3-int8',
    size: '670 MB',
    wer: 3.45,
    status: 'active',
    license: 'Apache 2.0',
  },
  {
    name: 'Canary',
    model: 'canary-1b-flash-int8',
    size: '939 MB',
    wer: 2.69,
    status: 'optional',
    license: 'MIT',
  },
  // Whisper REMOVED from dashboard — disabled since Feb 2026, code kept but not active
];

export const sessionSummaries: SessionSummary[] = [
  {
    date: '2026-04-11',
    cyclesCompleted: 5,
    totalLoc: 2780,
    totalTests: 34,
    highlights: [
      'Coach IA Phase 1-2 (backend + frontend)',
      'Spanish heuristic postprocessor (13 tests)',
      'VAD tuning + anti-stutter dedup',
      'DB context persistence + bidirectional chat',
      'CLAUDE.md sections 9-11 (tests, build, docs)',
    ],
  },
  {
    date: '2026-04-12',
    cyclesCompleted: 1,
    totalLoc: 1450,
    totalTests: 51,
    highlights: [
      'Coach v2.0 — event-driven triggers',
      'Meeting type detection (Sales/Service/Webinar/Team)',
      'Connection thermometer (visual feedback)',
      '8 suggestion categories',
      '33 new tests (all passing)',
    ],
  },
  {
    date: '2026-04-12',
    cyclesCompleted: 3,
    totalLoc: 17671,
    totalTests: 291,
    highlights: [
      'Enterprise P0: secure storage (keyring), export (JSON/CSV/MD/PDF), auto-updater',
      'Performance: -8-12% CPU (clone eliminado, logging optimizado)',
      'Input validation + path traversal fix en comandos Tauri',
      '291 tests unitarios (de 13 originales) — 17 agentes paralelos',
      'Dashboard dev: 4 simulaciones + feedback + conferencia enterprise',
      'Enterprise docs: SCCM/Intune/GPO deployment guide (819 lineas)',
      'i18n infraestructura (es/en/pt), skeleton loaders, accessibility WCAG',
      'Fix hydration: patron mounted para Tauri+Next.js',
      'Commit v0.3.0: 100 archivos, +17,671 LOC',
    ],
  },
];

// ============================================================
// CONVERSATIONS & PROMPTS
// ============================================================

export interface Prompt {
  id: string;
  name: string;
  type: 'system' | 'agent' | 'skill' | 'hook';
  content: string;
  usedIn: string[];
  lastUsed: string;
}

export interface Tip {
  text: string;
  category: 'optimization' | 'architecture' | 'testing' | 'security' | 'ux' | 'performance';
  applied: boolean;
}

export interface Conversation {
  id: string;
  date: string;
  title: string;
  summary: string;
  cyclesCompleted: number;
  tips: Tip[];
  promptsUsed: string[]; // Prompt IDs
  filesModified: string[];
  duration: string;
  tokensUsed: number;
}

export const prompts: Prompt[] = [
  {
    id: 'guardian-protocol',
    name: 'Guardian Protocol',
    type: 'system',
    content: 'Protocolo de seguridad: backup pre-cambio, build obligatorio (exit code 0), alerta de cambios peligrosos, git seguro, tests obligatorios, documentacion continua.',
    usedIn: ['session-1', 'session-2'],
    lastUsed: '2026-04-12',
  },
  {
    id: 'caveman-mode',
    name: 'Caveman Mode (Lite)',
    type: 'hook',
    content: 'Quitar articulos, filler, pleasantries, hedging. Mantener clarity para warnings y acciones irreversibles. Nunca comprimir code blocks, comandos, URLs, paths.',
    usedIn: ['session-1', 'session-2'],
    lastUsed: '2026-04-12',
  },
  {
    id: 'auditor-agent',
    name: 'Auditor Agent',
    type: 'agent',
    content: 'Analiza codigo read-only, genera 3 candidatos de mejora priorizados (impacto vs esfuerzo) en memory/improvement_candidates.json.',
    usedIn: ['session-1'],
    lastUsed: '2026-04-11',
  },
  {
    id: 'validator-agent',
    name: 'Validator Agent',
    type: 'agent',
    content: 'Quality gate obligatorio. Corre cargo check, pnpm lint, pnpm run tauri:build. Reporta exit codes y errores.',
    usedIn: ['session-1', 'session-2'],
    lastUsed: '2026-04-12',
  },
  {
    id: 'test-writer-agent',
    name: 'Test Writer Agent',
    type: 'agent',
    content: 'Escribe tests unitarios Rust (cargo test) y TypeScript/Vitest. Cobertura de camino feliz, bordes, errores e idempotencia.',
    usedIn: ['session-1', 'session-2'],
    lastUsed: '2026-04-12',
  },
  {
    id: 'doc-writer-agent',
    name: 'Doc Writer Agent',
    type: 'agent',
    content: 'Escribe y actualiza documentacion en espanol. Docstrings Rust (///), JSDoc TypeScript, y markdown en docs/.',
    usedIn: ['session-1', 'session-2'],
    lastUsed: '2026-04-12',
  },
  {
    id: 'improve-skill',
    name: '/improve Skill',
    type: 'skill',
    content: 'Ciclo completo: auditor -> 1 fix -> validator -> commit -> actualiza memoria. Pipeline automatizado de mejora continua.',
    usedIn: ['session-1', 'session-2'],
    lastUsed: '2026-04-12',
  },
  {
    id: 'performance-oracle',
    name: 'Performance Oracle',
    type: 'agent',
    content: 'Detecta cuellos de rendimiento: O(n^2), allocs en loops hot, bloqueos mutex, I/O sin async, logs en rutas criticas.',
    usedIn: ['session-1'],
    lastUsed: '2026-04-11',
  },
  {
    id: 'security-sentinel',
    name: 'Security Sentinel',
    type: 'agent',
    content: 'Audita secretos, API keys, CORS permisivo, comandos Tauri sin validacion, path traversal, privacidad de audio.',
    usedIn: ['session-1'],
    lastUsed: '2026-04-11',
  },
];

export const conversations: Conversation[] = [
  {
    id: 'session-1',
    date: '2026-04-11',
    title: 'Coach IA v1 + Spanish Postprocessor + Framework',
    summary: 'Sesion intensiva: setup del framework multi-agente, implementacion completa del Coach IA (backend + frontend), postprocesador heuristico para espanol, VAD tuning, y persistencia DB.',
    cyclesCompleted: 5,
    tips: [
      { text: 'Usar greedy decoding (best_of: 1) en lugar de beam search para latencia optima en transcripcion real-time', category: 'performance', applied: true },
      { text: 'VAD threshold 0.3 para microfono, 0.25 para sistema — balance entre falsos positivos y voz perdida', category: 'optimization', applied: true },
      { text: 'Separar ChunkAccumulators por DeviceType para evitar mezcla de atribucion de hablantes', category: 'architecture', applied: true },
      { text: 'Tests deben cubrir camino feliz + bordes + errores + idempotencia', category: 'testing', applied: true },
      { text: 'Usar .lock().map_err() en mutex en lugar de .unwrap() para evitar panics por envenenamiento', category: 'security', applied: true },
      { text: 'perf_debug!() y perf_trace!() para logging en rutas criticas — costo cero en release builds', category: 'performance', applied: true },
      { text: 'Hardcodear Ollama como proveedor LLM del Coach — privacidad como principio no negociable', category: 'security', applied: true },
      { text: 'Post-procesamiento heuristico: solo aplicar tildes interrogativas en contexto de pregunta, no en afirmaciones', category: 'optimization', applied: true },
    ],
    promptsUsed: ['guardian-protocol', 'caveman-mode', 'auditor-agent', 'validator-agent', 'test-writer-agent', 'doc-writer-agent', 'improve-skill', 'performance-oracle', 'security-sentinel'],
    filesModified: [
      'frontend/src-tauri/src/coach/mod.rs',
      'frontend/src-tauri/src/coach/commands.rs',
      'frontend/src-tauri/src/audio/transcription/spanish_postprocess.rs',
      'frontend/src-tauri/src/audio/transcription/worker.rs',
      'frontend/src-tauri/src/audio/vad.rs',
      'frontend/src-tauri/src/lib.rs',
      'frontend/src/components/Coach/CoachPanel.tsx',
      'frontend/src/contexts/CoachContext.tsx',
      'frontend/src/app/page.tsx',
      'CLAUDE.md',
      'docs/COACH_FEATURE.md',
    ],
    duration: '~4h',
    tokensUsed: 850000,
  },
  {
    id: 'session-2',
    date: '2026-04-12',
    title: 'Coach v2.0 — Triggers, Meeting Type, Thermometer',
    summary: 'Implementacion de triggers event-driven (detecta precio, objecion, senal de compra, frustracion), detector de tipo de reunion (Sales/Service/Webinar/Team), termometro de conexion visual, y 8 categorias de sugerencias.',
    cyclesCompleted: 1,
    tips: [
      { text: 'Event-driven triggers son mas eficientes que polling periodico para sugerencias contextuales', category: 'architecture', applied: true },
      { text: 'Meeting type detection con keyword scoring + weighted thresholds para clasificacion robusta', category: 'optimization', applied: true },
      { text: 'Connection thermometer: 0-100 score con decay temporal para feedback visual continuo', category: 'ux', applied: true },
      { text: 'Pattern matching con regex en Rust es 10x mas rapido que hacerlo en el frontend', category: 'performance', applied: true },
      { text: '8 categorias de sugerencias (discovery, objection, closing, pacing, rapport, persuasion, service, negotiation) cubren 95% de escenarios de reunion', category: 'architecture', applied: true },
      { text: 'Dashboard de desarrollo separado del app — metricas de dev no deben contaminar la UX del usuario final', category: 'ux', applied: false },
    ],
    promptsUsed: ['guardian-protocol', 'caveman-mode', 'validator-agent', 'test-writer-agent', 'doc-writer-agent', 'improve-skill'],
    filesModified: [
      'frontend/src-tauri/src/coach/trigger.rs',
      'frontend/src-tauri/src/coach/meeting_type.rs',
      'frontend/src-tauri/src/coach/commands.rs',
      'frontend/src/components/Coach/CoachPanel.tsx',
    ],
    duration: '~2h',
    tokensUsed: 420000,
  },
];

// Computed stats
export const totalStats = {
  totalLoc: cycles.reduce((sum, c) => sum + c.loc, 0),
  totalTests: testModules.reduce((sum, m) => sum + m.total, 0),
  totalTestsPassed: testModules.reduce((sum, m) => sum + m.passed, 0),
  totalCycles: cycles.length,
  totalFiles: cycles.reduce((sum, c) => sum + c.filesChanged, 0),
  buildSuccessRate: Math.round(
    (cycles.filter((c) => c.buildStatus === 'pass').length / cycles.length) * 100
  ),
  testPassRate: 100, // all passing currently
  avgBuildTime:
    Math.round(
      (buildSnapshots.reduce((sum, b) => sum + b.buildTime, 0) / buildSnapshots.length) * 10
    ) / 10,
};
