'use client';

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

type Rating = 'useful' | 'sometimes' | 'not_useful';

interface SessionFeedbackModalProps {
  open: boolean;
  meetingId: string | null;
  onSubmit: () => void;
}

const RATINGS: { value: Rating; emoji: string; label: string }[] = [
  { value: 'useful', emoji: '✅', label: 'Muy útil' },
  { value: 'sometimes', emoji: '〰️', label: 'A veces' },
  { value: 'not_useful', emoji: '❌', label: 'Poco útil' },
];

export function SessionFeedbackModal({ open, meetingId, onSubmit }: SessionFeedbackModalProps) {
  const { maityUser } = useAuth();
  const [selected, setSelected] = useState<Rating | null>(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);

    try {
      // 1. Save locally to SQLite
      const feedbackId = await invoke<string>('save_user_feedback', {
        meetingId: meetingId ?? undefined,
        feedbackType: 'session_rating',
        rating: selected,
        message: message.trim() || undefined,
        metadata: undefined,
      });

      // 2. Sync to Supabase (fire-and-forget — non-blocking)
      if (maityUser?.id) {
        supabase
          .from('user_feedback')
          .insert({
            id: feedbackId,
            user_id: maityUser.id,
            feedback_type: 'session_rating',
            message: message.trim() || selected,
            metadata: { rating: selected, meeting_id: meetingId },
            platform: 'desktop',
            app_version: undefined,
          })
          .then(({ error }) => {
            if (error) console.warn('[SessionFeedback] Supabase sync failed (non-fatal):', error);
          });
      }
    } catch (e) {
      console.error('[SessionFeedback] Failed to save feedback:', e);
    } finally {
      setSubmitting(false);
      onSubmit();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-5">
        <div className="text-center">
          <p className="text-base font-semibold text-foreground">¿Qué tan útil fue el coach hoy?</p>
          <p className="text-xs text-muted-foreground mt-1">Selecciona una opción para continuar</p>
        </div>

        {/* Rating options */}
        <div className="flex gap-3 justify-center">
          {RATINGS.map(({ value, emoji, label }) => (
            <button
              key={value}
              onClick={() => setSelected(value)}
              className={[
                'flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition-all',
                'text-sm font-medium flex-1',
                selected === value
                  ? 'border-[#485df4] bg-[#485df4]/15 text-foreground'
                  : 'border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground',
              ].join(' ')}
            >
              <span className="text-xl">{emoji}</span>
              <span className="text-xs">{label}</span>
            </button>
          ))}
        </div>

        {/* Optional text */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">¿Qué podría mejorar? (opcional)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 280))}
            placeholder="Escribe aquí..."
            rows={3}
            className="w-full rounded-lg bg-white/5 border border-white/10 text-sm text-foreground placeholder:text-muted-foreground/50 px-3 py-2 resize-none focus:outline-none focus:border-white/30 transition-colors"
          />
          <span className="text-xs text-muted-foreground/50 text-right">{message.length}/280</span>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!selected || submitting}
          className={[
            'w-full py-2.5 rounded-xl text-sm font-semibold transition-all',
            selected && !submitting
              ? 'bg-[#485df4] hover:bg-[#3a4edb] text-white'
              : 'bg-white/10 text-muted-foreground cursor-not-allowed',
          ].join(' ')}
        >
          {submitting ? 'Enviando...' : 'Enviar →'}
        </button>
      </div>
    </div>
  );
}
