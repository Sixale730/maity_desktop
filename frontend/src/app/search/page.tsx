'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { Search, Loader2, AlertCircle, Database, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface SearchResult {
  meeting_id: string;
  segment_id: string;
  text: string;
  score: number;
  audio_start_time: number | null;
  audio_end_time: number | null;
  source_type: string | null;
}

interface IndexStats {
  total_segments: number;
  indexed_segments: number;
  model: string;
}

export default function SemanticSearchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const initialQ = params?.get('q') ?? '';
  const meetingId = params?.get('meeting') ?? null;

  const [query, setQuery] = useState(initialQ);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [indexing, setIndexing] = useState(false);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await invoke<SearchResult[]>('semantic_search', {
        query: q,
        topK: 20,
        meetingId,
        model: null,
        endpoint: null,
      });
      setResults(r);
      if (r.length === 0) {
        toast.info('Sin resultados — ¿indexaste reuniones?');
      }
    } catch (e) {
      setError(typeof e === 'string' ? e : `${e}`);
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    invoke<IndexStats>('semantic_get_index_stats', { meetingId, model: null })
      .then(setStats)
      .catch(() => null);
  }, [meetingId]);

  useEffect(() => {
    if (initialQ) runSearch(initialQ);
  }, [initialQ, runSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  const handleIndexAll = async () => {
    if (!meetingId) {
      toast.error('Indexa desde una reunión específica (parámetro ?meeting=ID)');
      return;
    }
    setIndexing(true);
    try {
      const r = await invoke<{ indexed_count: number; skipped_count: number; elapsed_ms: number }>(
        'semantic_index_meeting',
        { meetingId, model: null, endpoint: null }
      );
      toast.success(
        `Indexados ${r.indexed_count} segmentos (${r.skipped_count} omitidos, ${(r.elapsed_ms / 1000).toFixed(1)}s)`
      );
      const s = await invoke<IndexStats>('semantic_get_index_stats', { meetingId, model: null });
      setStats(s);
    } catch (e) {
      toast.error(`Error indexando: ${e}`);
    } finally {
      setIndexing(false);
    }
  };

  const formatScore = (s: number) => `${(s * 100).toFixed(1)}%`;
  const formatTime = (sec: number | null) => {
    if (sec == null) return '';
    const m = Math.floor(sec / 60);
    const r = Math.floor(sec % 60);
    return `[${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}]`;
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-950">
      <div className="px-6 pt-6 pb-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 text-blue-500" />
          <h1 className="text-lg font-semibold">Búsqueda semántica</h1>
          {stats && (
            <span className="text-xs text-gray-500 ml-2">
              {stats.indexed_segments}/{stats.total_segments} segmentos indexados ·{' '}
              <code>{stats.model}</code>
            </span>
          )}
        </div>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Pregunta natural: "cuándo hablamos del precio", "objeciones del cliente"…'
              className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50 transition"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Buscar'}
          </button>
          {meetingId && (
            <button
              type="button"
              onClick={handleIndexAll}
              disabled={indexing}
              title="Calcula embeddings para los segmentos de esta reunión vía Ollama"
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm rounded-lg disabled:opacity-50 transition flex items-center gap-1.5"
            >
              {indexing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              Indexar
            </button>
          )}
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="flex items-start gap-3 p-4 mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <div className="font-medium">Error de búsqueda</div>
              <div className="text-xs opacity-80 mt-1">{error}</div>
              <div className="text-xs mt-2 opacity-90">
                Verifica que Ollama corra y que tengas <code>nomic-embed-text</code>:{' '}
                <code>ollama pull nomic-embed-text</code>
              </div>
            </div>
          </div>
        )}

        {!loading && results.length === 0 && !error && query && (
          <div className="text-center py-12 text-gray-500 text-sm">
            Sin resultados para “{query}”. Indexa la reunión primero o prueba otra pregunta.
          </div>
        )}

        <ul className="space-y-2">
          {results.map((r, i) => (
            <li
              key={`${r.segment_id}-${i}`}
              className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 hover:border-blue-400 dark:hover:border-blue-600 transition cursor-pointer"
              onClick={() => router.push(`/meeting-details?id=${r.meeting_id}`)}
            >
              <div className="flex items-center gap-2 mb-1.5 text-xs">
                <span className="font-mono px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                  {formatScore(r.score)}
                </span>
                {r.audio_start_time != null && (
                  <span className="font-mono text-gray-500">{formatTime(r.audio_start_time)}</span>
                )}
                {r.source_type && (
                  <span
                    className={
                      r.source_type === 'user'
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }
                  >
                    {r.source_type === 'user' ? '🎤 Usuario' : '👥 Interlocutor'}
                  </span>
                )}
                <span className="text-gray-400">·</span>
                <code className="text-[10px] text-gray-400 truncate">{r.meeting_id}</code>
              </div>
              <div className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed">{r.text}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
