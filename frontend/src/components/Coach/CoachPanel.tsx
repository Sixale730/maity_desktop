'use client';

/**
 * CoachPanel — Panel lateral fijo que muestra las sugerencias del copiloto IA.
 *
 * Diseño:
 * - Width 320px, fijo a la derecha del TranscriptPanel
 * - Tarjetas grandes (font 18px) legibles de reojo
 * - Color por categoría
 * - Timestamp relativo
 * - Indicador de loading + estado Ollama
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, MessageCircleQuestion, ShieldAlert, Target, Clock, Heart, Loader2, WifiOff, Send, MessageSquare, Lightbulb, HandCoins, Users2, DollarSign } from 'lucide-react';
import { useCoach, CoachSuggestion, CoachChatMessage } from '@/contexts/CoachContext';
import { ConnectionThermometer } from './ConnectionThermometer';
import { MeetingTypeBadge } from './MeetingTypeBadge';

const CATEGORY_STYLE: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
  icebreaker: { color: 'text-yellow-300', bg: 'bg-yellow-500/10 border-yellow-500/40', icon: <Sparkles className="w-4 h-4" />, label: 'Romper hielo' },
  discovery: { color: 'text-cyan-300', bg: 'bg-cyan-500/10 border-cyan-500/40', icon: <MessageCircleQuestion className="w-4 h-4" />, label: 'Descubrir' },
  question: { color: 'text-blue-300', bg: 'bg-blue-500/10 border-blue-500/40', icon: <MessageCircleQuestion className="w-4 h-4" />, label: 'Pregunta' },
  objection: { color: 'text-orange-300', bg: 'bg-orange-500/10 border-orange-500/40', icon: <ShieldAlert className="w-4 h-4" />, label: 'Objeción' },
  closing: { color: 'text-green-300', bg: 'bg-green-500/10 border-green-500/40', icon: <Target className="w-4 h-4" />, label: 'Cierre' },
  pacing: { color: 'text-purple-300', bg: 'bg-purple-500/10 border-purple-500/40', icon: <Clock className="w-4 h-4" />, label: 'Ritmo' },
  rapport: { color: 'text-pink-300', bg: 'bg-pink-500/10 border-pink-500/40', icon: <Heart className="w-4 h-4" />, label: 'Rapport' },
  persuasion: { color: 'text-indigo-300', bg: 'bg-indigo-500/10 border-indigo-500/40', icon: <Sparkles className="w-4 h-4" />, label: 'Persuasión' },
  service: { color: 'text-red-300', bg: 'bg-red-500/10 border-red-500/40', icon: <HandCoins className="w-4 h-4" />, label: 'Servicio' },
  negotiation: { color: 'text-amber-300', bg: 'bg-amber-500/10 border-amber-500/40', icon: <DollarSign className="w-4 h-4" />, label: 'Negociación' },
};

const PRIORITY_BADGE: Record<string, { label: string; emoji: string; color: string }> = {
  critical: { label: 'Crítico', emoji: '🔴', color: 'bg-red-500/20 text-red-300 border-red-500/40' },
  important: { label: 'Importante', emoji: '🟡', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
  soft: { label: 'Sugerencia', emoji: '🟢', color: 'bg-green-500/20 text-green-300 border-green-500/40' },
};

function categoryStyle(category: string) {
  return CATEGORY_STYLE[category] ?? CATEGORY_STYLE.pacing;
}

function relativeTime(timestamp: number): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, nowSec - timestamp);
  if (diff < 5) return 'ahora';
  if (diff < 60) return `hace ${diff}s`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `hace ${min}m`;
  return `hace ${Math.floor(min / 60)}h`;
}

function SuggestionCard({ suggestion }: { suggestion: CoachSuggestion }) {
  const style = categoryStyle(suggestion.category);
  const borderColor =
    suggestion.priority === 'critical' ? 'border-l-red-500' :
    suggestion.priority === 'important' ? 'border-l-yellow-500' : 'border-l-green-500';
  const isCritical = suggestion.priority === 'critical';
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={`rounded-md border border-l-2 ${borderColor} ${style.bg} p-2 shadow-sm group`}
      role={isCritical ? 'alert' : undefined}
      title={`${relativeTime(suggestion.timestamp)} · conf ${(suggestion.confidence * 100).toFixed(0)}% · ${suggestion.latency_ms}ms`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`${style.color}`}>{style.icon}</span>
        <span className={`text-[10px] uppercase tracking-wide font-medium ${style.color}`}>{style.label}</span>
        {suggestion.technique && (
          <span className="text-[9px] text-gray-500 ml-auto">({suggestion.technique})</span>
        )}
      </div>
      <p className="text-[13px] leading-snug text-gray-50 font-medium">
        {suggestion.tip}
      </p>
    </motion.div>
  );
}

type CoachTab = 'tips' | 'chat';

function ChatMessageBubble({ msg }: { msg: CoachChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-[14px] leading-snug ${
          isUser
            ? 'bg-blue-600/30 border border-blue-500/40 text-blue-50'
            : 'bg-gray-800/60 border border-gray-700/40 text-gray-100'
        }`}
      >
        <div>{msg.content}</div>
        {!isUser && (msg.latency_ms || msg.context_turns !== undefined) && (
          <div className="mt-1 text-[10px] text-gray-500">
            {msg.context_turns !== undefined && `${msg.context_turns} turnos · `}
            {msg.latency_ms && `${msg.latency_ms}ms · `}
            {msg.model && msg.model.split(':')[0]}
          </div>
        )}
      </div>
    </div>
  );
}

export function CoachPanel() {
  const {
    suggestions,
    enabled,
    status,
    loading,
    triggerNow,
    chatMessages,
    chatLoading,
    sendChatMessage,
    clearChat,
    metrics,
    meetingType,
    setMeetingType,
    meetingTypeAutoDetected,
  } = useCoach();

  const [tab, setTab] = useState<CoachTab>('tips');
  const [chatInput, setChatInput] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll cuando llegan nuevos mensajes de chat
  useEffect(() => {
    if (tab === 'chat' && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, tab]);

  if (!enabled) {
    return null;
  }

  // Tips persistentes: TODAS las sugerencias de la sesión, más recientes arriba
  const visible = [...suggestions].reverse();
  const ollamaDown = status && !status.ollama_running;

  // Formato duración mm:ss
  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  const talkPct = Math.round(metrics.userTalkRatio * 100);
  const talkPctColor =
    metrics.totalWords === 0
      ? 'text-gray-500'
      : talkPct > 65
      ? 'text-orange-300'
      : talkPct < 35
      ? 'text-blue-300'
      : 'text-green-300';

  const handleSend = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    await sendChatMessage(msg);
  };

  return (
    <aside className="flex flex-col w-[340px] flex-shrink-0 border-l border-gray-800 bg-gray-900/40 backdrop-blur-sm" role="complementary" aria-label="Copiloto de reuniones">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-blue-300 flex-shrink-0" />
          <h2 className="text-sm font-semibold text-gray-100">Coach IA</h2>
          {(loading || chatLoading) && (
            <Loader2 className="w-3 h-3 text-blue-300 animate-spin" />
          )}
        </div>
        <MeetingTypeBadge
          value={meetingType}
          onChange={setMeetingType}
          autoDetected={meetingTypeAutoDetected}
        />
      </div>

      {/* Connection Thermometer (gamificación) */}
      <ConnectionThermometer
        score={metrics.connectionScore}
        trend={metrics.connectionTrend}
      />

      {/* Acciones secundarias (Tip ahora / Limpiar) */}
      <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-gray-800 bg-gray-900/30">
        {tab === 'tips' && (
          <button
            onClick={() => triggerNow()}
            disabled={loading || !!ollamaDown}
            className="text-[10px] px-2 py-1 rounded bg-blue-600/20 text-blue-200 border border-blue-500/30 hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
            title="Pedir sugerencia ahora"
          >
            Tip ahora
          </button>
        )}
        {tab === 'chat' && chatMessages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-[10px] px-2 py-1 rounded bg-gray-700/40 text-gray-300 border border-gray-600/40 hover:bg-gray-700/60 transition"
            title="Limpiar chat"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Métricas en vivo */}
      <div className="grid grid-cols-3 gap-1 px-3 py-2 border-b border-gray-800 bg-gray-900/60">
        <div className="flex flex-col items-center">
          <span className="text-[9px] uppercase text-gray-500 tracking-wide">Duración</span>
          <span className="text-sm font-mono text-gray-200">{formatDuration(metrics.durationSec)}</span>
        </div>
        <div className="flex flex-col items-center border-x border-gray-800">
          <span className="text-[9px] uppercase text-gray-500 tracking-wide">Tú hablas</span>
          <span className={`text-sm font-mono ${talkPctColor}`}>{metrics.totalWords > 0 ? `${talkPct}%` : '—'}</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[9px] uppercase text-gray-500 tracking-wide">Preguntas</span>
          <span className="text-sm font-mono text-gray-200">{metrics.userQuestions}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        <button
          onClick={() => setTab('tips')}
          className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium transition ${
            tab === 'tips'
              ? 'text-blue-200 border-b-2 border-blue-400 bg-blue-500/10'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <Lightbulb className="w-3 h-3" /> Tips ({suggestions.length})
        </button>
        <button
          onClick={() => setTab('chat')}
          className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium transition ${
            tab === 'chat'
              ? 'text-blue-200 border-b-2 border-blue-400 bg-blue-500/10'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <MessageSquare className="w-3 h-3" /> Chat ({chatMessages.length})
        </button>
      </div>

      {/* Status banner */}
      {ollamaDown && (
        <div className="mx-4 mt-3 p-2 rounded border border-yellow-600/40 bg-yellow-900/20 text-yellow-200 text-xs flex items-center gap-2">
          <WifiOff className="w-3 h-3" />
          <span>Ollama no detectado. Inicia Ollama para activar el coach.</span>
        </div>
      )}

      {/* Tab content: TIPS */}
      {tab === 'tips' && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" role="region" aria-live="polite" aria-label="Sugerencias del coach">
          <AnimatePresence mode="popLayout">
            {visible.length === 0 && !loading && !ollamaDown && (
              <div className="text-center text-gray-500 text-sm mt-8 px-2">
                Aquí aparecerán tips cortos durante la reunión.
                <br />
                <span className="text-gray-600 text-xs">
                  Primer tip en ~20s o cuando el interlocutor termine de hablar.
                </span>
              </div>
            )}
            {visible.map((s, idx) => (
              <SuggestionCard key={`${s.timestamp}-${idx}`} suggestion={s} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Tab content: CHAT */}
      {tab === 'chat' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div
            ref={chatScrollRef}
            className="flex-1 min-h-0 overflow-y-auto px-3 py-3"
          >
            {chatMessages.length === 0 && !chatLoading && (
              <div className="text-center text-gray-500 text-sm mt-8 px-2">
                Pregúntame sobre la reunión.
                <br />
                <span className="text-gray-600 text-xs">
                  &ldquo;¿Qué objeción dio el cliente?&rdquo;, &ldquo;¿Cómo cierro?&rdquo;, &ldquo;Resume lo que pasó&rdquo;.
                </span>
              </div>
            )}
            {chatMessages.map((m, idx) => (
              <ChatMessageBubble key={`${m.timestamp}-${idx}`} msg={m} />
            ))}
            {chatLoading && (
              <div className="flex justify-start mb-2">
                <div className="bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2">
                  <Loader2 className="w-4 h-4 text-blue-300 animate-spin" />
                </div>
              </div>
            )}
          </div>
          <form
            className="px-3 py-2 border-t border-gray-800 flex gap-2 flex-shrink-0"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={chatLoading}
              placeholder="Pregunta al coach..."
              autoComplete="off"
              className="flex-1 bg-gray-800/60 border border-gray-700/60 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500/60 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
              className="px-3 py-2 rounded bg-blue-600/30 border border-blue-500/40 text-blue-100 hover:bg-blue-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              title="Enviar (Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {/* Footer */}
      {status && (
        <div className="px-4 py-2 border-t border-gray-800 text-[10px] text-gray-500 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                status.ollama_running ? 'bg-green-400' : 'bg-red-400'
              }`}
            />
            {status.ollama_running ? 'Ollama OK' : 'Ollama OFF'}
          </span>
          {status.last_latency_ms > 0 && (
            <span>último: {status.last_latency_ms}ms</span>
          )}
        </div>
      )}
    </aside>
  );
}
