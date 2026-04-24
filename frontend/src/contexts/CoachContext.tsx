'use client';

/**
 * CoachContext — Copiloto IA en tiempo real para reuniones.
 *
 * Conecta el stream de transcripción con el backend Rust `coach::commands`
 * para generar sugerencias cortas accionables (1-2 oraciones) durante una
 * conversación en vivo.
 *
 * Trigger: cada 20s o cuando el interlocutor termina de hablar (silencio
 * detectado vía evento `transcript-update` con `is_partial: false` y
 * `source_type: "interlocutor"`).
 *
 * 100% local: solo Ollama. Las transcripciones nunca salen del equipo.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTranscripts } from './TranscriptContext';
import { useRecordingState } from './RecordingStateContext';
import { logger } from '@/lib/logger';

/** Mensaje de chat del usuario o respuesta del coach. */
export interface CoachChatMessage {
  /** ID estable único (para React keys y stream demux). */
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Solo para assistant: latencia y modelo del LLM */
  latency_ms?: number;
  first_token_ms?: number;
  model?: string;
  /** Solo para assistant: turnos de contexto incluidos */
  context_turns?: number;
  /** true mientras el stream está activo (streaming token-por-token). */
  streaming?: boolean;
}

export type CoachCategory =
  | 'icebreaker'
  | 'question'
  | 'objection'
  | 'closing'
  | 'pacing'
  | 'rapport';

export type CoachTipType = 'recognition' | 'observation' | 'corrective' | 'introspective';

export interface CoachSuggestion {
  tip: string;
  category: CoachCategory | string;
  /** v2.0: subcategoría específica del framework */
  subcategory?: string;
  /** v2.0: framework de origen (SPIN, LAER, Voss, etc.) */
  technique?: string;
  /** v2.0: "critical" | "important" | "soft" */
  priority: 'critical' | 'important' | 'soft' | string;
  confidence: number;
  /** V3.1: tipo de tip — el coach rota entre 4 para no ser repetitivo. */
  tip_type?: CoachTipType | string;
  timestamp: number;
  model: string;
  latency_ms: number;
}

/** Tipos de reunión. */
export type MeetingType = 'auto' | 'sales' | 'service' | 'webinar' | 'team_meeting';

export interface CoachStatus {
  model: string;
  ollama_running: boolean;
  last_latency_ms: number;
}

export type CoachModel =
  | 'phi3.5:3.8b-mini-instruct-q4_K_M'
  | 'gemma4:e4b';

/** Métricas en vivo de la conversación. */
export interface QuestionEntry {
  text: string;
  speaker: 'user' | 'interlocutor';
  timestamp: number; // ms since session start
}

export interface CoachMetrics {
  totalWords: number;
  userWords: number;
  interlocutorWords: number;
  userTalkRatio: number;
  userQuestions: number;
  interlocutorQuestions: number;
  durationSec: number;
  turnCount: number;
  connectionScore: number;
  connectionTrend: 'rising' | 'falling' | 'stable';
  /** Palabras por minuto del usuario. */
  userWpm: number;
  /** Monólogo más largo del usuario en segundos. */
  longestUserMonologueSec: number;
  /** Historial de preguntas detectadas */
  questionHistory: QuestionEntry[];
}

interface CoachContextType {
  /** Todas las sugerencias de la sesión (persistentes, no se borran). */
  suggestions: CoachSuggestion[];
  /** Si el coach está habilitado para esta sesión. */
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  /** Modelo activo (puede ser cualquier string Ollama). */
  model: string;
  setModel: (m: string) => Promise<void>;
  /** Estado del backend (Ollama up, latencia). */
  status: CoachStatus | null;
  /** Hay un request de sugerencia en vuelo. */
  loading: boolean;
  /** Disparar una sugerencia manualmente (botón "Test" o "Pídeme un tip"). */
  triggerNow: () => Promise<void>;
  /** Limpia las sugerencias del panel. */
  clearSuggestions: () => void;
  /** Última sugerencia (para resaltar en UI). */
  latestSuggestion: CoachSuggestion | null;
  // Chat
  /** Historial de mensajes del chat. */
  chatMessages: CoachChatMessage[];
  /** Hay un request de chat en vuelo. */
  chatLoading: boolean;
  /** Envía un mensaje al coach y recibe respuesta. */
  sendChatMessage: (message: string) => Promise<void>;
  /** Limpia el historial de chat. */
  clearChat: () => void;
  // Métricas
  /** Métricas en vivo de la conversación. */
  metrics: CoachMetrics;
  // v2.0: Meeting type + gamificación
  /** Tipo de reunión actual (auto o manual). */
  meetingType: MeetingType;
  /** Cambia el tipo de reunión (override manual). */
  setMeetingType: (t: MeetingType) => void;
  /** True si el tipo fue detectado automáticamente (no override manual). */
  meetingTypeAutoDetected: boolean;
}

const CoachContext = createContext<CoachContextType | undefined>(undefined);

// Tips persistentes durante toda la sesión. Se limpian al iniciar nueva grabación.
const MAX_SUGGESTIONS = 100;
// v2.0: cooldown estricto entre tips (no más timer cada 20s).
const TIP_COOLDOWN_MS = 15_000; // 15s entre tips — ~4/min máx si hay señal
const FIRST_MINUTES_COOLDOWN_MS = 30_000; // 30s: permite tips tempranos
const POST_PRICE_SUPPRESS_MS = 8_000; // 8s sin tips después de precio
const MIN_CONFIDENCE = 0.3; // era 0.5 — gemma4 es conservador, 0.3 captura más tips útiles
// Contexto para coach_suggest (tips): reducido a 4k chars para prefill rápido en Ollama.
// Antes 20k → LLM procesaba 5k+ tokens de transcripción por request (latencia 8-12s).
// Con 4k + prompt v3 (~2400 tokens), total prefill ~3k tokens → 1-2s.
const MAX_CONTEXT_CHARS = 4_000;
// Meeting type detector: correrlo a los 45s de grabación (suficiente contexto).
const MEETING_TYPE_DETECTOR_DELAY_MS = 45_000;

export function CoachProvider({ children }: { children: ReactNode }) {
  const { transcriptsRef, currentMeetingId } = useTranscripts();
  const recordingState = useRecordingState();
  const isRecording = recordingState.isRecording;

  const [suggestions, setSuggestions] = useState<CoachSuggestion[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [model, setModelState] = useState<string>('gemma4:latest');
  const [status, setStatus] = useState<CoachStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [latestSuggestion, setLatestSuggestion] =
    useState<CoachSuggestion | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<CoachChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  // Métricas state
  const [metrics, setMetrics] = useState<CoachMetrics>({
    totalWords: 0,
    userWords: 0,
    interlocutorWords: 0,
    userTalkRatio: 0,
    userQuestions: 0,
    interlocutorQuestions: 0,
    durationSec: 0,
    turnCount: 0,
    connectionScore: 50,
    connectionTrend: 'stable',
    userWpm: 0,
    longestUserMonologueSec: 0,
    questionHistory: [],
  });
  const sessionStartRef = useRef<number | null>(null);
  const scoreHistoryRef = useRef<number[]>([]);
  const suggestionsRef = useRef<CoachSuggestion[]>([]);
  useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  // v2.0: meeting type state
  const [meetingType, setMeetingTypeState] = useState<MeetingType>('auto');
  const [meetingTypeAutoDetected, setMeetingTypeAutoDetected] = useState(false);

  // Refs para evitar stale closures en intervalos/listeners
  const enabledRef = useRef(enabled);
  const loadingRef = useRef(loading);
  const lastTipTimestampRef = useRef<number>(0);
  const suppressUntilRef = useRef<number>(0);
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meetingTypeRef = useRef(meetingType);
  useEffect(() => {
    meetingTypeRef.current = meetingType;
  }, [meetingType]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  /**
   * Construye el contexto para el coach: TODA la conversación desde inicio,
   * etiquetada con speakers. Solo trunca si excede MAX_CONTEXT_CHARS (20k),
   * en cuyo caso descarta los turnos más VIEJOS (cola viva).
   *
   * Fix asamblea 2026-04-11: antes era rolling 2000 chars → el coach perdía
   * contexto histórico. Ahora ve todo el arco de la reunión.
   */
  const buildWindow = useCallback((): string => {
    const all = transcriptsRef.current ?? [];
    const lines: string[] = [];
    let totalChars = 0;
    // Iterar de atrás hacia adelante (tail first) hasta llenar MAX_CONTEXT_CHARS
    for (let i = all.length - 1; i >= 0; i--) {
      const t = all[i] as any;
      const speaker = t.source_type === 'interlocutor' ? 'INTERLOCUTOR' : 'USUARIO';
      const text = (t.text ?? '').trim();
      if (!text) continue;
      const line = `${speaker}: ${text}`;
      if (totalChars + line.length > MAX_CONTEXT_CHARS && lines.length > 0) break;
      lines.unshift(line);
      totalChars += line.length;
    }
    return lines.join('\n');
  }, [transcriptsRef]);

  /**
   * Cuenta las palabras totales del transcript (para decidir si vale la pena
   * disparar otra sugerencia).
   */
  const countWords = useCallback((): number => {
    const all = transcriptsRef.current ?? [];
    let total = 0;
    for (const t of all) {
      total += ((t as any).text ?? '').split(/\s+/).filter(Boolean).length;
    }
    return total;
  }, [transcriptsRef]);

  /**
   * Detecta el idioma del transcript reciente (heurística simple por palabras
   * frecuentes en español).
   */
  const detectLanguage = useCallback((): string => {
    const window = buildWindow().toLowerCase();
    if (!window) return 'es';
    const esMarkers = [' que ', ' los ', ' para ', ' está ', ' con ', ' por ', ' una ', ' del '];
    const enMarkers = [' the ', ' and ', ' you ', ' have ', ' with ', ' for ', ' this '];
    const esCount = esMarkers.filter((m) => window.includes(m)).length;
    const enCount = enMarkers.filter((m) => window.includes(m)).length;
    return enCount > esCount ? 'en' : 'es';
  }, [buildWindow]);

  /**
   * Llama al backend para generar una sugerencia v2.0 con todo el contexto estratégico.
   *
   * @param suggestedCategory Pista opcional del trigger detector (categoría de señal detectada)
   */
  const triggerNow = useCallback(async (suggestedCategory?: string, triggerSignalParam?: string) => {
    if (loadingRef.current) {
      logger.debug('[Coach] Skip: ya hay request en vuelo');
      return;
    }
    let window = buildWindow();
    if (!window || window.length < 30) {
      logger.debug('[Coach] Skip: ventana muy corta');
      return;
    }
    // Agregar contexto de calidad de servicio al window para que el LLM lo considere
    const currentScore = scoreHistoryRef.current.slice(-1)[0] ?? 50;
    if (currentScore <= 30) {
      window = `[ALERTA: Calidad de servicio MUY BAJA (${currentScore}/100). El usuario necesita mejorar su tono y escucha activa.]\n${window}`;
    } else if (currentScore <= 50) {
      window = `[Nota: Calidad de servicio por debajo del promedio (${currentScore}/100). Sugerir mejoras de comunicacion.]\n${window}`;
    }

    // Cooldowns estrictos v2.0
    const now = Date.now();
    if (now < suppressUntilRef.current) {
      logger.debug(`[Coach] Skip: suppress activo hasta ${new Date(suppressUntilRef.current).toISOString()}`);
      return;
    }
    if (now - lastTipTimestampRef.current < TIP_COOLDOWN_MS) {
      logger.debug(`[Coach] Skip: cooldown 45s activo`);
      return;
    }
    // Primeros 2 min: máx 1 tip
    if (sessionStartRef.current) {
      const sessionAge = now - sessionStartRef.current;
      if (sessionAge < FIRST_MINUTES_COOLDOWN_MS && suggestionsRef.current.length >= 1) {
        logger.debug('[Coach] Skip: primeros 2 min, ya hay 1 tip');
        return;
      }
    }

    setLoading(true);
    try {
      const language = detectLanguage();
      const minute = sessionStartRef.current
        ? Math.floor((now - sessionStartRef.current) / 60_000)
        : 0;
      // V3.1: incluir tip_type en cada entrada previa para que el LLM rote (anti-repetición).
      // Formato compacto "[tipo] tip" — el prompt V3 LITE entiende la convención.
      const previousTips = suggestionsRef.current.slice(-5).map((s) => {
        const tt = s.tip_type ?? 'observation';
        return `[${tt}] ${s.tip}`;
      });

      const suggestion = await invoke<CoachSuggestion>('coach_suggest', {
        window,
        role: 'usuario',
        language,
        meetingId: currentMeetingId ?? undefined,
        meetingType: meetingTypeRef.current,
        minute,
        previousTips,
        suggestedCategory: suggestedCategory ?? null,
        triggerSignal: triggerSignalParam ?? null,
      });

      // Filtro de confianza
      if (suggestion.confidence < MIN_CONFIDENCE) {
        logger.debug(
          `[Coach] Sugerencia descartada por baja confianza: ${suggestion.confidence}`
        );
        return;
      }

      // Filtro de calidad: tips correctivos/observación DEBEN tener frase concreta
      const tipText = suggestion.tip || '';
      const hasQuotedPhrase = tipText.includes("'") || tipText.includes(":");
      const isVague = /\b(empatiza|conecta|rapport|escucha activa|framework|LATTE|SPIN|HEARD|MEDDPICC)\b/i.test(tipText);
      if (isVague) {
        logger.debug(`[Coach] Tip descartado por jerga/vaguedad: ${tipText}`);
        return;
      }
      if (!hasQuotedPhrase && (suggestion.tip_type === 'corrective' || suggestion.tip_type === 'observation')) {
        logger.debug(`[Coach] Tip ${suggestion.tip_type} descartado por no tener frase concreta: ${tipText}`);
        return;
      }

      // Marcar timestamp del tip para cooldown
      lastTipTimestampRef.current = Date.now();

      setSuggestions((prev) => {
        const next = [...prev, suggestion];
        if (next.length > MAX_SUGGESTIONS) {
          return next.slice(next.length - MAX_SUGGESTIONS);
        }
        return next;
      });
      setLatestSuggestion(suggestion);
    } catch (e) {
      logger.warn(`[Coach] Error al generar sugerencia: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [buildWindow, detectLanguage, currentMeetingId]);

  /**
   * Cambia el modelo del backend y actualiza el estado local.
   * Acepta cualquier modelo Ollama instalado.
   */
  const setModel = useCallback(async (m: string) => {
    try {
      await invoke('coach_set_model', { modelId: m });
      setModelState(m);
      logger.info(`[Coach] Modelo cambiado a: ${m}`);
    } catch (e) {
      logger.error(`[Coach] Error al cambiar modelo: ${e}`);
      throw e;
    }
  }, []);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setLatestSuggestion(null);
    lastTipTimestampRef.current = 0;
    suppressUntilRef.current = 0;
  }, []);

  /**
   * Envía un mensaje al coach (chat bidireccional).
   * El backend lee el transcript completo de la reunión actual y responde
   * con contexto multi-turn.
   */
  const sendChatMessage = useCallback(async (message: string) => {
    logger.info(`[Coach Chat] 📤 sendChatMessage called with: "${message}"`);
    if (!message.trim() || chatLoading) {
      logger.warn(`[Coach Chat] Skipped: empty=${!message.trim()}, loading=${chatLoading}`);
      return;
    }

    // Optimistic UI: user msg aparece en <16ms
    const ts = Date.now();
    const userMsg: CoachChatMessage = {
      id: `u-${ts}`,
      role: 'user',
      content: message.trim(),
      timestamp: Math.floor(ts / 1000),
    };
    // Placeholder del assistant (streaming=true → renderizará typing indicator + tokens incrementales)
    const assistantId = `a-${ts}`;
    const assistantPlaceholder: CoachChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Math.floor(ts / 1000),
      streaming: true,
    };
    setChatMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setChatLoading(true);

    const history = chatMessages.map((m) => ({ role: m.role, content: m.content }));
    const liveTranscript = buildWindow();

    try {
      const streamId = await invoke<string>('coach_chat_stream', {
        message: message.trim(),
        meetingId: currentMeetingId ?? undefined,
        liveTranscript,
        history,
        model: null,
      });

      // Listeners del stream — se limpian al recibir complete/error.
      const unlistenToken = await listen<{ stream_id: string; delta: string; done: boolean }>(
        'coach-chat-token',
        (event) => {
          if (event.payload.stream_id !== streamId) return;
          if (event.payload.delta.length === 0) return;
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + event.payload.delta } : m,
            ),
          );
        },
      );
      const unlistenComplete = await listen<{
        stream_id: string;
        model: string;
        latency_ms: number;
        first_token_ms: number;
        total_tokens: number;
      }>('coach-chat-complete', (event) => {
        if (event.payload.stream_id !== streamId) return;
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  latency_ms: event.payload.latency_ms,
                  first_token_ms: event.payload.first_token_ms,
                  model: event.payload.model,
                }
              : m,
          ),
        );
        setChatLoading(false);
        unlistenToken();
        unlistenComplete();
        unlistenError();
      });
      const unlistenError = await listen<{ stream_id: string; error: string }>(
        'coach-chat-error',
        (event) => {
          if (event.payload.stream_id !== streamId) return;
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, streaming: false, content: `Error: ${event.payload.error}. Verifica que Ollama esté corriendo.` }
                : m,
            ),
          );
          setChatLoading(false);
          unlistenToken();
          unlistenComplete();
          unlistenError();
        },
      );
    } catch (e) {
      logger.error(`[Coach Chat] Error invoke: ${e}`);
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, streaming: false, content: `Error: ${e}. Verifica que Ollama esté corriendo.` }
            : m,
        ),
      );
      setChatLoading(false);
    }
  }, [chatMessages, chatLoading, currentMeetingId, buildWindow]);

  const clearChat = useCallback(() => {
    setChatMessages([]);
  }, []);

  /**
   * Effect 1: poll del status del backend cada 30s mientras está habilitado.
   */
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const s = await invoke<CoachStatus>('coach_get_status');
        if (!cancelled) setStatus(s);
      } catch (e) {
        if (!cancelled) {
          setStatus({ model, ollama_running: false, last_latency_ms: 0 });
        }
      }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, model]);

  /**
   * Effect 2 v2.0: TRIGGER EVENT-DRIVEN con detectores sin LLM.
   *
   * Escucha `transcript-update` del interlocutor y corre detectores de señales
   * (backend trigger.rs via invoke('coach_analyze_trigger')). Si hay señal
   * crítica o importante, dispara `triggerNow` con `suggestedCategory` como
   * pista al LLM.
   *
   * Cooldown de 45s + suppress post-precio de 15s controlados en `triggerNow`.
   */
  useEffect(() => {
    if (!enabled || !isRecording) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const setup = async () => {
      const fn = await listen<any>('transcript-update', async (event) => {
        if (cancelled) return;
        const u = event.payload;
        if (
          !u ||
          u.is_partial === true ||
          !u.text ||
          u.text.trim().length < 5
        ) {
          return;
        }
        // Analyze triggers for BOTH user and interlocutor speech
        const isInterlocutor = u.source_type === 'interlocutor';

        // Profanity detection differentiated by speaker
        const profanityRegex = /\b(mierda|carajo|puta|chingad|joder|estúpido|estupido|idiota|imbécil|imbecil|maldito|maldita|hijueputa|pendej|cabron|cabrón|verga|pinche)\b/i;
        if (profanityRegex.test(u.text)) {
          if (isInterlocutor) {
            // CLIENT angry — coach user on how to calm them
            const calmClientTip = {
              tip: "Cliente molesto. Dile: 'Entiendo tu frustración, tienes razón. ¿Cómo puedo solucionarlo?'",
              category: "service",
              confidence: 0.98,
              priority: "critical" as const,
              timestamp: Date.now(),
              model: "heuristic",
              latency_ms: 0,
            };
            setSuggestions(prev => [calmClientTip, ...prev].slice(0, MAX_SUGGESTIONS));
            lastTipTimestampRef.current = Date.now();
          } else {
            // USER losing control — self-regulation tip
            const selfControlTip = {
              tip: "Cuidado con tu tono. Di: 'Disculpa si sonó brusco, quiero ayudarte. Vamos a resolverlo juntos.'",
              category: "self_control",
              confidence: 0.98,
              priority: "critical" as const,
              timestamp: Date.now(),
              model: "heuristic",
              latency_ms: 0,
            };
            setSuggestions(prev => [selfControlTip, ...prev].slice(0, MAX_SUGGESTIONS));
            lastTipTimestampRef.current = Date.now();
            return; // User profanity is urgent, skip LLM tip
          }
        }

        try {
          const signals = await invoke<Array<{ category: string; priority: string; signal: string }>>(
            'coach_analyze_trigger',
            { text: u.text, isInterlocutor }
          );

          if (signals.length === 0) {
            logger.debug('[Coach] Sin señales en turno, skip');
            return;
          }

          const top = signals[0];
          logger.info(`[Coach] Señal detectada: ${top.signal} (${top.priority}) → categoría ${top.category}`);

          // Post-precio: activar suppress de 15s
          if (top.signal === 'price_discussion' || top.signal === 'objection_detected') {
            const priceDetected = u.text.toLowerCase().match(/precio|cuesta|costo|caro|cara|presupuesto/);
            if (priceDetected) {
              suppressUntilRef.current = Date.now() + POST_PRICE_SUPPRESS_MS;
              logger.info('[Coach] Post-precio: suppress 15s activo');
            }
          }

          // Disparar tip con pista de categoría + signal (speaker attribution)
          if (top.priority === 'critical' || top.priority === 'important') {
            await triggerNow(top.category, top.signal);
          } else if (top.priority === 'soft') {
            const age = Date.now() - lastTipTimestampRef.current;
            if (age > 35_000) {
              await triggerNow(top.category, top.signal);
            }
          }
        } catch (e) {
          logger.warn(`[Coach] Error en trigger analyze: ${e}`);
          const age = Date.now() - lastTipTimestampRef.current;
          if (age > 35_000) {
            logger.info('[Coach] Fallback: trigger fallo, intentando tip generico');
            await triggerNow(undefined);
          }
        }
      });

      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [enabled, isRecording, triggerNow]);

  /**
   * Effect 3 v2.0: auto-detect meeting type a los 45s de grabación.
   * Usa backend coach_detect_meeting_type que llama gemma3:4b (rápido).
   * Cachea el resultado en memoria. Solo si user no hizo override manual.
   */
  useEffect(() => {
    if (!enabled || !isRecording) return;
    if (meetingTypeRef.current !== 'auto' && meetingTypeAutoDetected === false) {
      // User ya eligió manualmente, no auto-detectar
      return;
    }
    const id = setTimeout(async () => {
      const window = buildWindow();
      if (window.length < 200) return; // Muy corto para clasificar
      try {
        const detected = await invoke<string>('coach_detect_meeting_type', {
          transcript: window,
          meetingId: currentMeetingId ?? undefined,
        });
        if (meetingTypeRef.current === 'auto' && detected !== 'auto') {
          setMeetingTypeState(detected as MeetingType);
          setMeetingTypeAutoDetected(true);
          logger.info(`[Coach] Meeting type auto-detectado: ${detected}`);
        }
      } catch (e) {
        logger.warn(`[Coach] Meeting type detect falló: ${e}`);
      }
    }, MEETING_TYPE_DETECTOR_DELAY_MS);

    return () => clearTimeout(id);
  }, [enabled, isRecording, buildWindow, currentMeetingId, meetingTypeAutoDetected]);

  /**
   * Effect 4: limpiar sugerencias al iniciar nueva grabación + marcar inicio.
   */
  useEffect(() => {
    if (isRecording) {
      clearSuggestions();
      sessionStartRef.current = Date.now();
    } else {
      sessionStartRef.current = null;
    }
  }, [isRecording, clearSuggestions]);

  /**
   * Effect 5: calcular métricas + connection score cada 3s mientras se graba.
   * Cero cost porque solo recorre transcriptsRef.current (array en memoria).
   */
  useEffect(() => {
    if (!isRecording) return;
    const computeMetrics = () => {
      const all = transcriptsRef.current ?? [];
      let userWords = 0;
      let interlocutorWords = 0;
      let userQuestions = 0;
      let interlocutorQuestions = 0;
      let nameUsedCount = 0;
      let empathyPhrases = 0;
      let longestUserRun = 0;
      let currentUserRun = 0;
      let userFrustrationCount = 0;
      let interlocutorFrustrationCount = 0;
      let interlocutorSatisfactionCount = 0;
      let userEmpathyCount = 0;
      const questionEntries: QuestionEntry[] = [];
      const satisfactionWords = /\b(excelente|perfecto|me encanta|impresionante|genial|increíble|fantástico|maravilloso|muy bien|buenísimo|gracias|agradezco)\b/i;
      const frustrationWords = /\b(terrible|pésimo|inaceptable|harto|harta|cancelar|demanda|queja|reclamo|mierda|carajo|puta|chingad|joder|estúpido|estupido|idiota|imbécil|imbecil|maldito|maldita|hijueputa|pendej|cabron|cabrón|verga|maldición|maldicion|pinche)\b/i;
      for (const t of all) {
        const text = ((t as any).text ?? '').trim();
        if (!text) continue;
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        const questionCount = (text.match(/¿/g) || []).length;
        const isInt = (t as any).source_type === 'interlocutor';

        // Track question history
        if (questionCount > 0 || text.includes('?')) {
          const speaker = isInt ? 'interlocutor' as const : 'user' as const;
          const ts = sessionStartRef.current ? (Date.now() - sessionStartRef.current) : 0;
          questionEntries.push({ text: text.substring(0, 200), speaker, timestamp: ts });
        }

        // Count frustration differentiated by speaker
        if (frustrationWords.test(text)) {
          if (isInt) interlocutorFrustrationCount++;
          else userFrustrationCount++;
        }

        // Count interlocutor satisfaction
        if (satisfactionWords.test(text) && isInt) {
          interlocutorSatisfactionCount++;
        }

        if (isInt) {
          interlocutorWords += wordCount;
          interlocutorQuestions += questionCount;
          if (currentUserRun > longestUserRun) longestUserRun = currentUserRun;
          currentUserRun = 0;
        } else {
          userWords += wordCount;
          userQuestions += questionCount;
          currentUserRun += wordCount;

          // Empatía: regex con palabras señalizadoras
          const empathyMatch = text
            .toLowerCase()
            .match(/\b(entiendo|veo|comprendo|tiene sentido|te escucho|imagino|disculpa|lo siento)\b/g);
          if (empathyMatch) {
            empathyPhrases += empathyMatch.length;
            userEmpathyCount += empathyMatch.length;
          }

          // Uso de nombres propios (heurística: palabra capitalizada en medio de frase)
          const words = text.split(/\s+/);
          for (let i = 1; i < words.length; i++) {
            const w = words[i];
            if (w.length >= 3 && /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/.test(w)) {
              nameUsedCount++;
            }
          }
        }
      }
      if (currentUserRun > longestUserRun) longestUserRun = currentUserRun;
      const totalWords = userWords + interlocutorWords;
      const userTalkRatio = totalWords > 0 ? userWords / totalWords : 0;
      const durationSec = sessionStartRef.current
        ? Math.floor((Date.now() - sessionStartRef.current) / 1000)
        : 0;

      // WPM: palabras del usuario / minutos de sesión
      const minutesElapsed = Math.max(0.5, durationSec / 60);
      const userWpm = Math.round(userWords / minutesElapsed);

      // Monólogo más largo en segundos (estimación: 150 WPM promedio → words / 2.5)
      const longestUserMonologueSec = Math.round(longestUserRun / 2.5);

      // Connection score algorithm v5.0 — CALIDAD DE SERVICIO
      // Evalua si el usuario esta dando buen servicio al cliente.
      // Frustration tiene peso DOMINANTE — una sola groseria del usuario
      // puede hundir el score. El termometro refleja calidad, no actividad.
      const minutesSinceStart = Math.max(0.5, durationSec / 60);
      let score = 50; // Baseline neutral

      // Contar cambios de turno (speaker switches)
      let turnChanges = 0;
      let prevSource = '';
      for (const t of all) {
        const src = (t as any).source_type ?? '';
        if (src && src !== prevSource) { turnChanges++; prevSource = src; }
      }

      // Contar groserías del USUARIO separadamente (penalizacion fuerte)
      let userProfanityCount = 0;
      const profanityRegex = /\b(mierda|carajo|puta|chingad|joder|estúpido|estupido|idiota|imbécil|imbecil|maldito|maldita|hijueputa|pendej|cabron|cabrón|verga|pinche|estúpida|estupida)\b/gi;
      for (const t of all) {
        if ((t as any).source_type !== 'interlocutor') {
          const text = ((t as any).text ?? '');
          const matches = text.match(profanityRegex);
          if (matches) userProfanityCount += matches.length;
        }
      }

      if (totalWords > 5) {
        // +15 pts: balance de participacion (ambos hablan, no monologo)
        const minSide = Math.min(userWords, interlocutorWords);
        const balance = totalWords > 0 ? minSide / totalWords : 0;
        score += Math.round(15 * Math.min(1, balance * 4));

        // +10 pts: preguntas (escucha activa)
        const totalQ = userQuestions + interlocutorQuestions;
        const qPerMin = totalQ / minutesSinceStart;
        score += Math.min(10, Math.round(qPerMin * 8));

        // +10 pts: variedad de turnos (conversacion fluida)
        const turnsPerMin = turnChanges / minutesSinceStart;
        score += Math.min(10, Math.round(turnsPerMin * 2));

        // +10 pts: empatia + uso de nombres (profesionalismo)
        score += Math.min(5, empathyPhrases * 3);
        score += Math.min(5, nameUsedCount * 3);

        // User frustration → STRONG penalty (user losing control)
        score -= userFrustrationCount * 12;

        // Interlocutor satisfaction → reward (user achieved client happiness)
        score += interlocutorSatisfactionCount * 6;

        // User empathy → reward (active listening)
        score += Math.min(15, userEmpathyCount * 3);

        // Interlocutor frustration → NEUTRAL (client might be frustrated but user handling well)
        // No penalty for this - it's an opportunity, not a failure

        // PENALIZACION DOMINANTE: groserías del usuario
        // Cada grosería resta 15 puntos — 2 groserías = score minimo
        score -= userProfanityCount * 15;

        // Penalizacion por monologo largo del usuario (habla sin dejar hablar)
        if (userTalkRatio > 0.75 && totalWords > 50) {
          score -= 10; // usuario domina >75% = mal servicio
        }

        score = Math.max(5, Math.min(100, score));
      } else {
        // Warm start: neutral, sube solo con interaccion real
        score = Math.min(50, 40 + turnChanges * 3);
      }

      // FEEDBACK AUTOMATICO basado en score — escalado por severidad
      const lastFeedback = (window as any).__lastScoreFeedback || 0;
      const prevScore = (window as any).__prevConnectionScore || 50;
      const canFeedback = Date.now() - lastFeedback > 20_000; // max 1 cada 20s

      if (canFeedback && totalWords > 20) {
        let feedbackTip: { tip: string; category: string; priority: string } | null = null;

        // User frustration escalation — detect if user tone is getting aggressive
        if (userFrustrationCount >= 2) {
          (window as any).__lastScoreFeedback = Date.now();
          setSuggestions(prev => [{
            tip: "Cuidado con tu tono. Di: 'disculpa, quiero asegurarme de ayudarte bien.'",
            category: "self_control",
            priority: "critical",
            confidence: 0.95,
            timestamp: Date.now(),
            model: "heuristic",
            latency_ms: 0,
          }, ...prev].slice(0, 20));
          return; // Skip other feedback when user frustration is critical
        }

        // NIVEL CRITICO: score <= 10 — servicio desastroso
        if (score <= 10) {
          feedbackTip = {
            tip: "Corrección: detente ahora. Di: 'Tienes razón, disculpa. ¿Cómo puedo resolver esto para ti?'",
            category: "service", priority: "critical",
          };
        // NIVEL ALERTA: score <= 25
        } else if (score <= 25) {
          feedbackTip = {
            tip: "Dile: 'Entiendo tu frustración. Déjame ver qué puedo hacer para solucionarlo ahora.'",
            category: "service", priority: "critical",
          };
        // NIVEL ADVERTENCIA: score <= 40
        } else if (score <= 40) {
          feedbackTip = {
            tip: "Pregúntale: '¿Cómo puedo ayudarte mejor con esto?'",
            category: "rapport", priority: "important",
          };
        // FELICITACION: score subio >15 puntos respecto al anterior
        } else if (score >= 70 && score - prevScore >= 15) {
          feedbackTip = {
            tip: "Excelente: la conversación fluye bien. Sigue con ese tono.",
            category: "rapport", priority: "soft",
          };
        // FELICITACION: score alto sostenido
        } else if (score >= 85 && prevScore >= 80) {
          feedbackTip = {
            tip: "Bien hecho: comunicación excepcional. El cliente se siente escuchado.",
            category: "rapport", priority: "soft",
          };
        }

        if (feedbackTip) {
          (window as any).__lastScoreFeedback = Date.now();
          setSuggestions(prev => [{
            ...feedbackTip!,
            confidence: 0.98,
            timestamp: Date.now(),
            model: "heuristic",
            latency_ms: 0,
          }, ...prev].slice(0, 20));
        }
      }
      (window as any).__prevConnectionScore = score;

      // Trend: comparar promedio reciente vs anterior (umbral 2 pts)
      const history = scoreHistoryRef.current;
      history.push(score);
      if (history.length > 15) history.shift();
      let trend: 'rising' | 'falling' | 'stable' = 'stable';
      if (history.length >= 3) {
        const recent = history.slice(-2).reduce((a, b) => a + b, 0) / 2;
        const older = history.slice(0, Math.max(1, history.length - 2)).reduce((a, b) => a + b, 0) /
          Math.max(1, history.length - 2);
        const delta = recent - older;
        if (delta > 2) trend = 'rising';
        else if (delta < -2) trend = 'falling';
      }

      setMetrics({
        totalWords,
        userWords,
        interlocutorWords,
        userTalkRatio,
        userQuestions,
        interlocutorQuestions,
        durationSec,
        turnCount: all.length,
        connectionScore: score,
        connectionTrend: trend,
        userWpm,
        longestUserMonologueSec,
        questionHistory: questionEntries.slice(-50),
      });
    };
    computeMetrics();
    const id = setInterval(computeMetrics, 3_000);
    return () => clearInterval(id);
  }, [isRecording, transcriptsRef]);

  /**
   * Effect 5.5: Nudge Engine — reemplaza timer periódico con coaching inteligente.
   * Evalúa métricas cada 10s vía Rust nudge_engine. Solo genera tip cuando hay
   * señal real (talk ratio, WPM, monólogo, etc.). Rate-limited: máx 1 cada 2 min.
   */
  const lastNudgeRef = useRef<{ time: number; type: string | null }>({ time: 0, type: null });
  useEffect(() => {
    if (!enabled || !isRecording) return;
    const NUDGE_COOLDOWN_MS = 120_000; // 2 minutos entre nudges

    const timer = setInterval(async () => {
      const now = Date.now();
      // Rate limit: máx 1 nudge cada 2 min
      if (now - lastNudgeRef.current.time < NUDGE_COOLDOWN_MS) return;
      // También respetar cooldown de tips LLM
      if (now - lastTipTimestampRef.current < TIP_COOLDOWN_MS) return;

      try {
        const result = await invoke<{
          should_nudge: boolean;
          nudge_type: string | null;
          tip: string | null;
          severity: string;
          category: string;
        }>('coach_evaluate_nudge', {
          userTalkRatio: metrics.userTalkRatio,
          userQuestions: metrics.userQuestions,
          sessionDurationSec: metrics.durationSec,
          userWpm: metrics.userWpm,
          longestUserMonologueSec: metrics.longestUserMonologueSec,
          healthScore: metrics.connectionScore,
          lastNudgeType: lastNudgeRef.current.type,
        });

        if (result.should_nudge && result.tip) {
          const nudgeSuggestion = {
            tip: result.tip,
            category: result.category,
            confidence: 0.9,
            priority: result.severity === 'high' ? 'critical' as const : result.severity === 'medium' ? 'important' as const : 'soft' as const,
            timestamp: Math.floor(now / 1000),
            model: 'nudge-engine',
            latency_ms: 0,
          };
          setSuggestions(prev => [nudgeSuggestion, ...prev].slice(0, MAX_SUGGESTIONS));
          lastTipTimestampRef.current = now;
          lastNudgeRef.current = { time: now, type: result.nudge_type };
          logger.info(`[Coach] Nudge: ${result.nudge_type} (${result.severity})`);
        }
      } catch (e) {
        // Silent — nudge evaluation failed
      }
    }, 10_000); // Evaluar cada 10s (pero rate-limited a 1 cada 2 min)

    return () => clearInterval(timer);
  }, [enabled, isRecording, metrics]);

  /**
   * Setter público para cambiar meeting type manualmente (override).
   */
  const setMeetingType = useCallback((t: MeetingType) => {
    setMeetingTypeState(t);
    setMeetingTypeAutoDetected(false);
    logger.info(`[Coach] Meeting type override manual: ${t}`);
  }, []);

  /**
   * Effect 6: al iniciar grabación, limpiar cache de meeting_type en backend
   * y resetear score history.
   */
  useEffect(() => {
    if (isRecording) {
      invoke('coach_clear_meeting_type_cache').catch(() => {});
      scoreHistoryRef.current = [];
      setMeetingTypeState('auto');
      setMeetingTypeAutoDetected(false);
      lastTipTimestampRef.current = 0;
      suppressUntilRef.current = 0;
    }
  }, [isRecording]);

  return (
    <CoachContext.Provider
      value={{
        suggestions,
        enabled,
        setEnabled,
        model,
        setModel,
        status,
        loading,
        triggerNow,
        clearSuggestions,
        latestSuggestion,
        chatMessages,
        chatLoading,
        sendChatMessage,
        clearChat,
        metrics,
        meetingType,
        setMeetingType,
        meetingTypeAutoDetected,
      }}
    >
      {children}
    </CoachContext.Provider>
  );
}

export function useCoach(): CoachContextType {
  const ctx = useContext(CoachContext);
  if (!ctx) {
    throw new Error('useCoach debe usarse dentro de CoachProvider');
  }
  return ctx;
}
