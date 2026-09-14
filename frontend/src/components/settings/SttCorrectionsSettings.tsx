'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowRight, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SttTerm } from '@/services/sttTerms.service';

const MAX_TERM_LEN = 80;

/**
 * Correcciones personales de transcripción: pares "como lo transcribe" →
 * "como debe decir" (ej. "alien" → "Allianz"). Se guardan en el store nativo
 * (`set_stt_personal_terms` reemplaza el array completo, patrón
 * `set_recording_preferences`) y Rust las aplica al post-proceso de cada
 * segmento. Los términos de la empresa llegan solos por separado
 * (SttTermsInitializer); aquí solo se editan los personales.
 */
export function SttCorrectionsSettings() {
  const [terms, setTerms] = useState<SttTerm[]>([]);
  const [wrong, setWrong] = useState('');
  const [right, setRight] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await invoke<SttTerm[]>('get_stt_personal_terms');
        if (!cancelled) setTerms(stored);
      } catch (err) {
        console.error('Error cargando términos personales:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: SttTerm[]) => {
    setSaving(true);
    try {
      await invoke('set_stt_personal_terms', { terms: next });
      setTerms(next);
    } catch (err) {
      toast.error('No se pudo guardar el término', { description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    const w = wrong.trim();
    const r = right.trim();
    if (!w || !r) return;
    if (w.length > MAX_TERM_LEN || r.length > MAX_TERM_LEN) {
      toast.error(`Cada término debe tener máximo ${MAX_TERM_LEN} caracteres`);
      return;
    }
    if (w.toLowerCase() === r.toLowerCase()) {
      toast.error('El término corregido debe ser distinto al original');
      return;
    }
    const next = [
      ...terms.filter((t) => t.wrong.toLowerCase() !== w.toLowerCase()),
      { wrong: w, right: r },
    ];
    await persist(next);
    setWrong('');
    setRight('');
  };

  const handleRemove = async (index: number) => {
    await persist(terms.filter((_, i) => i !== index));
  };

  return (
    <div className="mt-8 border-t border-[#e7e7e9] dark:border-gray-700 pt-6">
      <Label className="block text-sm font-medium text-[#3a3a3c] dark:text-gray-200 mb-1">
        Correcciones de transcripción
      </Label>
      <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mb-3 mx-1">
        Si un nombre o término sale mal transcrito de forma repetida (por ejemplo
        &quot;alien&quot; en lugar de &quot;Allianz&quot;), agrégalo aquí y se corregirá
        automáticamente en tus próximas grabaciones.
      </p>

      <div className="flex items-center gap-2 mx-1">
        <Input
          value={wrong}
          onChange={(e) => setWrong(e.target.value)}
          placeholder="Cómo lo transcribe"
          maxLength={MAX_TERM_LEN}
          className="focus:ring-1 focus:ring-[#485df4] focus:border-[#485df4]"
        />
        <ArrowRight className="h-4 w-4 shrink-0 text-[#6a6a6d]" />
        <Input
          value={right}
          onChange={(e) => setRight(e.target.value)}
          placeholder="Cómo debe decir"
          maxLength={MAX_TERM_LEN}
          className="focus:ring-1 focus:ring-[#485df4] focus:border-[#485df4]"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAdd();
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={saving || !wrong.trim() || !right.trim()}
          onClick={() => void handleAdd()}
          title="Agregar corrección"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mt-3 mx-1">Cargando…</p>
      ) : terms.length > 0 ? (
        <ul className="mt-3 mx-1 space-y-1">
          {terms.map((t, i) => (
            <li
              key={`${t.wrong}-${i}`}
              className="flex items-center justify-between rounded-md bg-[#f4f4f5] dark:bg-gray-800 px-3 py-1.5 text-sm"
            >
              <span className="truncate text-[#3a3a3c] dark:text-gray-200">
                {t.wrong} <span className="text-[#6a6a6d]">→</span> {t.right}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={saving}
                onClick={() => void handleRemove(i)}
                title="Eliminar corrección"
              >
                <Trash2 className="h-4 w-4 text-[#6a6a6d]" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
