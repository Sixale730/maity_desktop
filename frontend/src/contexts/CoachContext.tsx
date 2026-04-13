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
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Solo para assistant: latencia y modelo del LLM */
  latency_ms?: number;
  model?: string;
  /** Solo para assistant: turnos de contexto incluidos */
  context_turns?: number;
}

export type CoachCategory =
  | 'icebreaker'
  | 'question'
  | 'objection'
  | 'closing'
  | 'pacing'
  | 'rapport';

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
export interface CoachMetrics {
  totalWords: number;
  userWords: number;
  interlocutorWords: number;
  /** 0.0-1.0: qué proporción habla el usuario. */
  userTalkRatio: number;
  /** Número de preguntas hechas por el usuario (cuenta '¿'). */
  userQuestions: number;
  /** Número de preguntas hechas por el interlocutor. */
  interlocutorQuestions: number;
  /** Duración de la sesión en segundos. */
  durationSec: number;
  /** Número total de turnos (segmentos). */
  turnCount: number;
  /** v2.0: score gamificado 0-100. */
  connectionScore: number;
  /** v2.0: tendencia reciente. */
  connectionTrend: 'rising' | 'falling' | 'stable';
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
const MAX_CONTEXT_CHARS = 20_000;
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
  const triggerNow = useCallback(async (suggestedCategory?: string) => {
    if (loadingRef.current) {
      logger.debug('[Coach] Skip: ya hay request en vuelo');
      return;
    }
    const window = buildWindow();
    if (!window || window.length < 30) {
      logger.debug('[Coach] Skip: ventana muy corta');
      return;
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
      const previousTips = suggestionsRef.current.slice(-5).map((s) => s.tip);

      const suggestion = await invoke<CoachSuggestion>('coach_suggest', {
        window,
        role: 'usuario',
        language,
        meetingId: currentMeetingId ?? undefined,
        meetingType: meetingTypeRef.current,
        minute,
        previousTips,
        suggestedCategory: suggestedCategory ?? null,
      });

      // Filtro de confianza
      if (suggestion.confidence < MIN_CONFIDENCE) {
        logger.debug(
          `[Coach] Sugerencia descartada por baja confianza: ${suggestion.confidence}`
        );
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

    const userMsg: CoachChatMessage = {
      role: 'user',
      content: message.trim(),
      timestamp: Math.floor(Date.now() / 1000),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    try {
      // Construir history para el backend (excluyendo el mensaje recién agregado)
      const history = chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Fix 2026-04-11: pasar transcript vivo del buffer frontend
      // porque durante grabación en vivo la DB aún está vacía.
      const liveTranscript = buildWindow();

      const response = await invoke<{
        answer: string;
        model: string;
        latency_ms: number;
        context_chars: number;
        context_turns: number;
        user_turns: number;
        interlocutor_turns: number;
      }>('coach_chat', {
        message: message.trim(),
        meetingId: currentMeetingId ?? undefined,
        liveTranscript,
        history,
        model: null,
      });

      const assistantMsg: CoachChatMessage = {
        role: 'assistant',
        content: response.answer,
        timestamp: Math.floor(Date.now() / 1000),
        latency_ms: response.latency_ms,
        model: response.model,
        context_turns: response.context_turns,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch (e) {
      logger.error(`[Coach Chat] Error: ${e}`);
      const errorMsg: CoachChatMessage = {
        role: 'assistant',
        content: `Error: ${e}. Verifica que Ollama esté corriendo.`,
        timestamp: Math.floor(Date.now() / 1000),
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    } finally {
      setChatLoading(false);
    }
  }, [chatMessages, chatLoading, currentMeetingId]);

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

    listen<any>('transcript-update', async (event) => {
      const u = event.payload;
      if (
        !u ||
        u.source_type !== 'interlocutor' ||
        u.is_partial === true ||
        !u.text ||
        u.text.trim().length < 5
      ) {
        return;
      }

      try {
        const signals = await invoke<Array<{ category: string; priority: string; signal: string }>>(
          'coach_analyze_trigger',
          { text: u.text, isInterlocutor: true }
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

        // Disparar tip con pista de categoría
        if (top.priority === 'critical' || top.priority === 'important') {
          await triggerNow(top.category);
        } else if (top.priority === 'soft') {
          // Soft: disparar si lleva más de 45s sin tip (era 120s)
          const age = Date.now() - lastTipTimestampRef.current;
          if (age > 45_000) {
            await triggerNow(top.category);
          }
        }
      } catch (e) {
        logger.warn(`[Coach] Error en trigger analyze: ${e}`);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
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
      let satisfactionSignals = 0;
      let frustrationSignals = 0;
      const satisfactionWords = /\b(excelente|perfecto|me encanta|impresionante|genial|increíble|fantástico|maravilloso|muy bien|buenísimo)\b/i;
      const frustrationWords = /\b(terrible|pésimo|inaceptable|harto|harta|cancelar|demanda|queja|reclamo)\b/i;
      for (const t of all) {
        const text = ((t as any).text ?? '').trim();
        if (!text) continue;
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        const questionCount = (text.match(/¿/g) || []).length;
        if ((t as any).source_type === 'interlocutor') {
          interlocutorWords += wordCount;
          interlocutorQuestions += questionCount;
          if (currentUserRun > longestUserRun) longestUserRun = currentUserRun;
          currentUserRun = 0;
          if (satisfactionWords.test(text)) satisfactionSignals++;
          if (frustrationWords.test(text)) frustrationSignals++;
        } else {
          userWords += wordCount;
          userQuestions += questionCount;
          currentUserRun += wordCount;
          // Empatía: regex con palabras señalizadoras
          const empathyMatch = text
            .toLowerCase()
            .match(/\b(entiendo|veo|comprendo|tiene sentido|te escucho|imagino)\b/g);
          if (empathyMatch) empathyPhrases += empathyMatch.length;
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

      // Connection score algorithm v4.0 — basado en actividad conversacional.
      // Funciona tanto si habla solo interlocutor como si es bidireccional.
      // Cambia cada 3s reflejando la dinámica real de la conversación.
      const minutesSinceStart = Math.max(0.5, durationSec / 60);
      let score = 0;

      // Contar cambios de turno (speaker switches)
      let turnChanges = 0;
      let prevSource = '';
      for (const t of all) {
        const src = (t as any).source_type ?? '';
        if (src && src !== prevSource) { turnChanges++; prevSource = src; }
      }

      if (totalWords > 5) {
        // 30 pts: actividad conversacional (palabras/minuto)
        const wordsPerMin = totalWords / minutesSinceStart;
        score += Math.min(30, Math.round(wordsPerMin * 0.25));

        // 20 pts: balance de participación (ideal: ambos hablan)
        const minSide = Math.min(userWords, interlocutorWords);
        const balance = totalWords > 0 ? minSide / totalWords : 0;
        score += Math.round(20 * Math.min(1, balance * 4));

        // 15 pts: preguntas (de cualquier lado)
        const totalQ = userQuestions + interlocutorQuestions;
        const qPerMin = totalQ / minutesSinceStart;
        score += Math.min(15, Math.round(qPerMin * 10));

        // 15 pts: variedad de turnos (no monólogo largo)
        const turnsPerMin = turnChanges / minutesSinceStart;
        score += Math.min(15, Math.round(turnsPerMin * 3));

        // 10 pts: empatía + nombres
        score += Math.min(5, empathyPhrases * 2);
        score += Math.min(5, nameUsedCount * 2);

        // +10/-10: emoción del cliente
        if (satisfactionSignals > frustrationSignals) score += Math.min(10, satisfactionSignals * 4);
        else if (frustrationSignals >= 2) score -= Math.min(15, frustrationSignals * 5);
        else if (frustrationSignals === 1) score -= 5;

        score = Math.max(5, Math.min(100, score));
      } else {
        // Warm start: sube con tiempo + turnos (no estático)
        score = Math.min(50, 25 + Math.round(minutesSinceStart * 8) + turnChanges * 3);
      }

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
      });
    };
    computeMetrics();
    const id = setInterval(computeMetrics, 3_000);
    return () => clearInterval(id);
  }, [isRecording, transcriptsRef]);

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
