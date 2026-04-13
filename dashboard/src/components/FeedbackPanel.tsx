import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardHeader, CardTitle } from './Card';

// ============================================================
// Feedback system: persists in localStorage
// ============================================================

export interface FeedbackEntry {
  id: string;
  simulationId: string;
  suggestionIndex: number;
  rating: 1 | 2 | 3 | 4 | 5;
  note: string;
  promptIssue?: string; // What's wrong with the prompt
  suggestedFix?: string; // How to fix the prompt
  category: 'prompt' | 'timing' | 'relevance' | 'tone' | 'technique' | 'other';
  createdAt: string;
}

export interface PromptNote {
  id: string;
  text: string;
  category: 'improve' | 'bug' | 'idea' | 'positive';
  priority: 'high' | 'medium' | 'low';
  resolved: boolean;
  createdAt: string;
}

const FEEDBACK_KEY = 'maity-dashboard-feedback';
const NOTES_KEY = 'maity-dashboard-prompt-notes';

function loadFeedback(): FeedbackEntry[] {
  try {
    return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]');
  } catch { return []; }
}

function saveFeedback(entries: FeedbackEntry[]) {
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(entries));
}

function loadNotes(): PromptNote[] {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) || '[]');
  } catch { return []; }
}

function saveNotes(notes: PromptNote[]) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

// ============================================================
// Inline Feedback Widget (used inside SuggestionCard)
// ============================================================

interface SuggestionFeedbackProps {
  simulationId: string;
  suggestionIndex: number;
  suggestionTip: string;
}

export function SuggestionFeedback({ simulationId, suggestionIndex, suggestionTip }: SuggestionFeedbackProps) {
  const [feedback, setFeedback] = useState<FeedbackEntry[]>(loadFeedback);
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [note, setNote] = useState('');
  const [category, setCategory] = useState<FeedbackEntry['category']>('relevance');
  const [promptIssue, setPromptIssue] = useState('');
  const [suggestedFix, setSuggestedFix] = useState('');

  const existing = feedback.find(
    (f) => f.simulationId === simulationId && f.suggestionIndex === suggestionIndex
  );

  const handleSubmit = () => {
    const entry: FeedbackEntry = {
      id: `fb-${Date.now()}`,
      simulationId,
      suggestionIndex,
      rating,
      note,
      promptIssue: promptIssue || undefined,
      suggestedFix: suggestedFix || undefined,
      category,
      createdAt: new Date().toISOString(),
    };

    const updated = [
      ...feedback.filter(
        (f) => !(f.simulationId === simulationId && f.suggestionIndex === suggestionIndex)
      ),
      entry,
    ];
    setFeedback(updated);
    saveFeedback(updated);
    setShowForm(false);
  };

  if (existing && !showForm) {
    return (
      <div className="mt-2 rounded-md bg-surface-0/80 border border-surface-3 p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-600">Tu feedback:</span>
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((s) => (
                <span key={s} className={`text-sm ${s <= existing.rating ? 'text-accent-amber' : 'text-surface-3'}`}>
                  ★
                </span>
              ))}
            </div>
            <span className="text-[9px] rounded bg-surface-3 px-1.5 py-0.5 text-gray-400">
              {existing.category}
            </span>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="text-[10px] text-brand-400 hover:underline"
          >
            Editar
          </button>
        </div>
        {existing.note && (
          <p className="mt-1 text-[10px] text-gray-500">{existing.note}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 rounded-md bg-surface-0/50 border border-dashed border-surface-4 px-3 py-1.5 text-[10px] text-gray-500 hover:border-brand-500/30 hover:text-brand-400 transition-colors w-full justify-center"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Dar feedback sobre esta sugerencia
        </button>
      ) : (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-md bg-surface-0 border border-brand-500/20 p-3 space-y-3"
          >
            <p className="text-[10px] text-gray-500 truncate">
              Re: "{suggestionTip}"
            </p>

            {/* Rating */}
            <div>
              <label className="text-[10px] text-gray-600 block mb-1">Calificacion</label>
              <div className="flex gap-1">
                {([1, 2, 3, 4, 5] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setRating(s)}
                    className={`text-lg transition-colors ${s <= rating ? 'text-accent-amber' : 'text-surface-4 hover:text-surface-3'}`}
                  >
                    ★
                  </button>
                ))}
                <span className="ml-2 text-[10px] text-gray-500 self-center">
                  {rating === 1 && 'Incorrecto'}
                  {rating === 2 && 'Poco util'}
                  {rating === 3 && 'Aceptable'}
                  {rating === 4 && 'Bueno'}
                  {rating === 5 && 'Excelente'}
                </span>
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="text-[10px] text-gray-600 block mb-1">Area de feedback</label>
              <div className="flex flex-wrap gap-1">
                {[
                  { id: 'prompt' as const, label: 'Prompt' },
                  { id: 'timing' as const, label: 'Timing' },
                  { id: 'relevance' as const, label: 'Relevancia' },
                  { id: 'tone' as const, label: 'Tono' },
                  { id: 'technique' as const, label: 'Tecnica' },
                  { id: 'other' as const, label: 'Otro' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setCategory(cat.id)}
                    className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                      category === cat.id
                        ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                        : 'bg-surface-2 text-gray-500 border border-surface-3 hover:border-surface-4'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Note */}
            <div>
              <label className="text-[10px] text-gray-600 block mb-1">Comentario</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Que opinas de esta sugerencia?"
                className="w-full rounded-md bg-surface-2 border border-surface-3 px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:border-brand-500/50 focus:outline-none resize-none"
                rows={2}
              />
            </div>

            {/* Prompt issue (optional) */}
            <div>
              <label className="text-[10px] text-gray-600 block mb-1">Problema con el prompt (opcional)</label>
              <textarea
                value={promptIssue}
                onChange={(e) => setPromptIssue(e.target.value)}
                placeholder="Ej: El prompt no considera que el cliente ya dijo X..."
                className="w-full rounded-md bg-surface-2 border border-surface-3 px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:border-brand-500/50 focus:outline-none resize-none"
                rows={2}
              />
            </div>

            {/* Suggested fix (optional) */}
            <div>
              <label className="text-[10px] text-gray-600 block mb-1">Sugerencia de mejora al prompt (opcional)</label>
              <textarea
                value={suggestedFix}
                onChange={(e) => setSuggestedFix(e.target.value)}
                placeholder="Ej: Agregar regla: si el cliente menciona que trabaja, priorizar velocidad sobre proceso"
                className="w-full rounded-md bg-surface-2 border border-surface-3 px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:border-brand-500/50 focus:outline-none resize-none"
                rows={2}
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="rounded px-3 py-1.5 text-[10px] text-gray-500 hover:text-gray-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                className="rounded bg-brand-500 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-brand-600 transition-colors"
              >
                Guardar Feedback
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

// ============================================================
// Prompt Notes Panel (global feedback for prompt refinement)
// ============================================================

export function PromptNotesPanel() {
  const [notes, setNotes] = useState<PromptNote[]>(loadNotes);
  const [feedback] = useState<FeedbackEntry[]>(loadFeedback);
  const [showAdd, setShowAdd] = useState(false);
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState<PromptNote['category']>('improve');
  const [newPriority, setNewPriority] = useState<PromptNote['priority']>('medium');

  useEffect(() => { saveNotes(notes); }, [notes]);

  const handleAdd = () => {
    if (!newText.trim()) return;
    const note: PromptNote = {
      id: `pn-${Date.now()}`,
      text: newText,
      category: newCategory,
      priority: newPriority,
      resolved: false,
      createdAt: new Date().toISOString(),
    };
    setNotes([note, ...notes]);
    setNewText('');
    setShowAdd(false);
  };

  const toggleResolved = (id: string) => {
    setNotes(notes.map((n) => n.id === id ? { ...n, resolved: !n.resolved } : n));
  };

  const deleteNote = (id: string) => {
    setNotes(notes.filter((n) => n.id !== id));
  };

  const catConfig: Record<string, { bg: string; text: string; label: string }> = {
    improve: { bg: 'bg-accent-amber/10', text: 'text-accent-amber', label: 'Mejorar' },
    bug: { bg: 'bg-accent-red/10', text: 'text-accent-red', label: 'Bug' },
    idea: { bg: 'bg-accent-purple/10', text: 'text-accent-purple', label: 'Idea' },
    positive: { bg: 'bg-accent-green/10', text: 'text-accent-green', label: 'Positivo' },
  };

  const priConfig: Record<string, { bg: string; text: string }> = {
    high: { bg: 'bg-accent-red/10', text: 'text-accent-red' },
    medium: { bg: 'bg-accent-amber/10', text: 'text-accent-amber' },
    low: { bg: 'bg-gray-500/10', text: 'text-gray-500' },
  };

  // Stats from feedback entries
  const avgRating = feedback.length > 0
    ? (feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length).toFixed(1)
    : 'N/A';
  const feedbackByCategory: Record<string, number> = {};
  feedback.forEach((f) => { feedbackByCategory[f.category] = (feedbackByCategory[f.category] || 0) + 1; });

  return (
    <Card delay={0.1}>
      <CardHeader>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-amber/10">
          <svg className="h-3.5 w-3.5 text-accent-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </div>
        <CardTitle>Feedback & Notas del Prompt</CardTitle>
      </CardHeader>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-md bg-surface-2/50 border border-surface-3 p-2 text-center">
          <p className="text-lg font-bold text-white">{feedback.length}</p>
          <p className="text-[9px] text-gray-600">Feedbacks</p>
        </div>
        <div className="rounded-md bg-surface-2/50 border border-surface-3 p-2 text-center">
          <p className="text-lg font-bold text-accent-amber">{avgRating}</p>
          <p className="text-[9px] text-gray-600">Rating Prom.</p>
        </div>
        <div className="rounded-md bg-surface-2/50 border border-surface-3 p-2 text-center">
          <p className="text-lg font-bold text-accent-purple">{notes.filter((n) => !n.resolved).length}</p>
          <p className="text-[9px] text-gray-600">Notas Abiertas</p>
        </div>
      </div>

      {/* Feedback by category */}
      {Object.keys(feedbackByCategory).length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] text-gray-600 mb-2">Feedback por area:</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(feedbackByCategory).map(([cat, count]) => (
              <span key={cat} className="rounded bg-surface-3 px-2 py-0.5 text-[10px] text-gray-400">
                {cat}: <span className="font-bold text-white">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Add note button */}
      <button
        onClick={() => setShowAdd(!showAdd)}
        className="w-full mb-3 rounded-md border border-dashed border-surface-4 bg-surface-0/50 py-2 text-[10px] text-gray-500 hover:border-brand-500/30 hover:text-brand-400 transition-colors"
      >
        + Agregar nota para refinar el prompt
      </button>

      {/* Add note form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3 rounded-md bg-surface-0 border border-brand-500/20 p-3 space-y-2"
          >
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Ej: El prompt deberia detectar cuando el cliente menciona competidores y priorizar retencion..."
              className="w-full rounded-md bg-surface-2 border border-surface-3 px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:border-brand-500/50 focus:outline-none resize-none"
              rows={3}
            />
            <div className="flex gap-2">
              <div className="flex gap-1">
                {(['improve', 'bug', 'idea', 'positive'] as const).map((cat) => {
                  const cfg = catConfig[cat];
                  return (
                    <button key={cat} onClick={() => setNewCategory(cat)}
                      className={`rounded px-2 py-1 text-[9px] font-medium transition-colors ${
                        newCategory === cat ? `${cfg.bg} ${cfg.text} border border-current/20` : 'bg-surface-2 text-gray-500 border border-surface-3'
                      }`}
                    >{cfg.label}</button>
                  );
                })}
              </div>
              <div className="flex gap-1">
                {(['high', 'medium', 'low'] as const).map((pri) => {
                  const cfg = priConfig[pri];
                  return (
                    <button key={pri} onClick={() => setNewPriority(pri)}
                      className={`rounded px-2 py-1 text-[9px] font-medium transition-colors ${
                        newPriority === pri ? `${cfg.bg} ${cfg.text} border border-current/20` : 'bg-surface-2 text-gray-500 border border-surface-3'
                      }`}
                    >{pri}</button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="text-[10px] text-gray-500">Cancelar</button>
              <button onClick={handleAdd} className="rounded bg-brand-500 px-3 py-1 text-[10px] font-medium text-white hover:bg-brand-600">Guardar</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notes list */}
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {notes.map((note) => {
          const cfg = catConfig[note.category];
          const pri = priConfig[note.priority];
          return (
            <div
              key={note.id}
              className={`rounded-md border p-2.5 transition-colors ${
                note.resolved ? 'border-surface-3 bg-surface-2/30 opacity-60' : 'border-surface-3 bg-surface-2/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => toggleResolved(note.id)}
                    className={`h-4 w-4 rounded border flex items-center justify-center text-[8px] transition-colors ${
                      note.resolved ? 'bg-accent-green/20 border-accent-green/40 text-accent-green' : 'border-surface-4 hover:border-brand-500/40'
                    }`}
                  >{note.resolved ? '✓' : ''}</button>
                  <span className={`rounded px-1 py-0.5 text-[8px] font-bold ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                  <span className={`rounded px-1 py-0.5 text-[8px] ${pri.bg} ${pri.text}`}>{note.priority}</span>
                </div>
                <button onClick={() => deleteNote(note.id)} className="text-[10px] text-gray-600 hover:text-accent-red">x</button>
              </div>
              <p className={`mt-1.5 text-xs leading-relaxed ${note.resolved ? 'text-gray-600 line-through' : 'text-gray-300'}`}>
                {note.text}
              </p>
              <span className="text-[9px] text-gray-700 mt-1 block">
                {new Date(note.createdAt).toLocaleDateString('es')}
              </span>
            </div>
          );
        })}
        {notes.length === 0 && (
          <p className="text-center text-[10px] text-gray-600 py-4">
            Sin notas. Agrega una para refinar el prompt del coach.
          </p>
        )}
      </div>
    </Card>
  );
}
