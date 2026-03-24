'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type {
  CommunicationFeedbackV4,
  DimensionBase,
  DimensionObjetivo,
  Hallazgo,
  SubPuntaje,
} from '../../services/conversations.service';

// ─── Helpers ────────────────────────────────────────────────────────

/** Derive puntaje_0_100 from puntaje_1_5 when the optimized prompt omits it */
function getScore100(sp: SubPuntaje): number {
  return sp.puntaje_0_100 ?? (sp.puntaje_1_5 > 0 ? (sp.puntaje_1_5 - 1) * 25 : 0);
}

function mapHallazgoType(tipo: string): 'ok' | 'warn' | 'bad' {
  const t = tipo.toLowerCase();
  if (['ok', 'acierto', 'fortaleza', 'positivo'].includes(t)) return 'ok';
  if (['warn', 'mejorable', 'oportunidad', 'mejora'].includes(t)) return 'warn';
  return 'bad';
}

function scoreToColor(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 75) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

// ─── Style maps ─────────────────────────────────────────────────────

const DIMENSION_STYLES: Record<string, { banner: string; border: string; dot: string }> = {
  proposito:  { banner: 'bg-red-500/15',    border: 'border-l-orange-500', dot: 'bg-orange-500' },
  claridad:   { banner: 'bg-blue-500/15',   border: 'border-l-blue-500',   dot: 'bg-blue-500' },
  estructura: { banner: 'bg-orange-500/15', border: 'border-l-amber-500',  dot: 'bg-amber-500' },
  persuasion: { banner: 'bg-purple-500/15', border: 'border-l-purple-500', dot: 'bg-purple-500' },
  adaptacion: { banner: 'bg-green-500/15',  border: 'border-l-green-500',  dot: 'bg-green-500' },
};
const DEFAULT_STYLE = { banner: 'bg-pink-500/15', border: 'border-l-pink-500', dot: 'bg-pink-500' };

const FALLBACK_QUE_MIDE: Record<string, string> = {
  claridad:   '¿Qué tan fácil es entenderte?',
  estructura: '¿Las ideas fluyen en orden lógico?',
  persuasion: '¿Qué tan persuasivo eres al comunicar?',
  adaptacion: '¿Se adaptan los participantes entre sí?',
  proposito:  '¿Se entiende cuál es tu propósito?',
};

const DIMENSION_LABELS: Record<string, string> = {
  proposito:  'Propósito',
  claridad:   'Claridad',
  estructura: 'Estructura',
  persuasion: 'Persuasión',
  adaptacion: 'Adaptación',
};

const SCORE_BADGE_VARIANTS: Record<string, string> = {
  green:  'bg-emerald-500/20 text-emerald-200',
  yellow: 'bg-yellow-500/20 text-yellow-200',
  red:    'bg-red-500/20 text-red-200',
};

// ─── Internal section shape ─────────────────────────────────────────

interface Section {
  key: string;
  title: string;
  queMide: string;
  score: number;
  tuResultado?: string;
  hallazgos: Hallazgo[];
  subScores?: { label: string; value: number }[];
}

// ─── Sub-components ─────────────────────────────────────────────────

function FindingSummary({ counts }: { counts: { ok: number; warn: number; bad: number } }) {
  return (
    <div className="flex gap-3 mt-2 text-xs font-semibold">
      {counts.ok > 0 && <span className="text-green-400">{counts.ok} aciertos</span>}
      {counts.warn > 0 && <span className="text-yellow-400">{counts.warn} mejorables</span>}
      {counts.bad > 0 && <span className="text-red-400">{counts.bad} críticos</span>}
    </div>
  );
}

function Finding({ hallazgo }: { hallazgo: Hallazgo }) {
  const [open, setOpen] = useState(false);
  const type = mapHallazgoType(hallazgo.tipo);

  const bgClass =
    type === 'ok' ? 'bg-green-500/10' : type === 'warn' ? 'bg-yellow-500/10' : 'bg-red-500/10';
  const borderClass =
    type === 'ok' ? 'border-l-green-500' : type === 'warn' ? 'border-l-yellow-500' : 'border-l-red-500';

  const hasDetail = !!(hallazgo.cita || hallazgo.por_que);

  return (
    <div className={`${bgClass} border-l-2 ${borderClass} rounded-lg mt-2.5 text-sm leading-relaxed`}>
      <button
        type="button"
        className="w-full flex items-center gap-2 p-3 text-left cursor-pointer hover:bg-white/5 rounded-lg transition-colors"
        onClick={() => hasDetail && setOpen(!open)}
      >
        <span className="font-bold flex-1 text-foreground">{hallazgo.texto}</span>
        {hasDetail && (
          <span className="text-xs text-muted-foreground shrink-0">{open ? '▾' : '▸'}</span>
        )}
      </button>

      {hallazgo.alternativa && (
        <div className="px-3 pb-1 -mt-1">
          <span className="text-xs font-semibold text-blue-400">→ </span>
          <span className="text-xs text-blue-300/80">
            {hallazgo.alternativa.replace(/^Alternativa:\s*/, '')}
          </span>
        </div>
      )}

      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {hallazgo.cita && (
            <div className="italic text-muted-foreground text-xs">«{hallazgo.cita}»</div>
          )}
          {hallazgo.por_que && (
            <div className="text-xs text-muted-foreground">
              <span className="font-semibold text-amber-400/80">¿Por qué importa?</span>{' '}
              {hallazgo.por_que}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubScoresBar({ subScores }: { subScores: { label: string; value: number }[] }) {
  return (
    <div className="mt-4 pt-4 border-t border-white/10">
      <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
        Desglose de claridad
      </div>
      <div className="space-y-2">
        {subScores.map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <span className="text-xs font-medium w-28 shrink-0 text-muted-foreground">
              {item.label}
            </span>
            <div className="flex-1 h-2.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  item.value >= 60 ? 'bg-green-500' : item.value >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${item.value}%` }}
              />
            </div>
            <span
              className={`text-xs font-bold w-8 text-right ${
                item.value >= 60 ? 'text-green-400' : item.value >= 40 ? 'text-yellow-400' : 'text-red-400'
              }`}
            >
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DimensionCard({ section }: { section: Section }) {
  const [open, setOpen] = useState(false);
  const colors = DIMENSION_STYLES[section.key] ?? DEFAULT_STYLE;

  const counts = { ok: 0, warn: 0, bad: 0 };
  section.hallazgos.forEach((h) => {
    counts[mapHallazgoType(h.tipo)]++;
  });

  const color = scoreToColor(section.score);

  return (
    <Card className="bg-card border border-border border-l-4 overflow-hidden" style={{ borderLeftColor: 'inherit' }}>
      <div className={`border-l-4 ${colors.border}`}>
        {/* Colored banner strip */}
        <div className={`${colors.banner} px-4 py-2`}>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {section.title}
            </span>
          </div>
        </div>

        <div className="p-5 pt-4">
          {/* que_mide + score badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-foreground">{section.queMide}</span>
            <Badge className={`${SCORE_BADGE_VARIANTS[color]}`}>{section.score}/100</Badge>
          </div>

          {/* tu_resultado */}
          {section.tuResultado && (
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {section.tuResultado}
            </p>
          )}

          {/* Toggle button */}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="text-sm font-semibold text-blue-400 mt-3 cursor-pointer hover:underline"
          >
            {open ? 'Ocultar hallazgos' : `Ver hallazgos (${section.hallazgos.length})`}{' '}
            {open ? '▲' : '▼'}
          </button>

          {/* Collapsible content */}
          {open && (
            <>
              <FindingSummary counts={counts} />

              {section.hallazgos.map((h, i) => (
                <Finding key={i} hallazgo={h} />
              ))}

              {section.subScores && <SubScoresBar subScores={section.subScores} />}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Dimension order ────────────────────────────────────────────────

const DIMENSION_ORDER = ['proposito', 'claridad', 'estructura', 'persuasion', 'adaptacion'] as const;

// ─── Main component ─────────────────────────────────────────────────

interface HallazgosSectionProps {
  feedback: CommunicationFeedbackV4;
}

export function HallazgosSection({ feedback }: HallazgosSectionProps) {
  if (!feedback.dimensiones) return null;

  const sections: Section[] = [];

  for (const dimKey of DIMENSION_ORDER) {
    const dim = feedback.dimensiones[dimKey as keyof typeof feedback.dimensiones];
    if (!dim || typeof dim !== 'object') continue;

    // Propósito is DimensionObjetivo with sub_puntajes
    if (dimKey === 'proposito') {
      const obj = dim as DimensionObjetivo;
      if (!obj.hallazgos || obj.hallazgos.length === 0) continue;

      const sub = obj.sub_puntajes;
      sections.push({
        key: dimKey,
        title: DIMENSION_LABELS[dimKey] ?? dimKey,
        queMide: obj.que_mide || FALLBACK_QUE_MIDE[dimKey],
        score: obj.puntaje,
        tuResultado: obj.tu_resultado,
        hallazgos: obj.hallazgos,
        subScores: sub
          ? [
              { label: '¿De qué habla?', value: getScore100(sub.especificidad) },
              { label: '¿Qué hacer?', value: getScore100(sub.accion) },
              { label: '¿Para cuándo?', value: getScore100(sub.temporalidad) },
              { label: '¿Quién?', value: getScore100(sub.responsable) },
              { label: '¿Cómo verificar?', value: getScore100(sub.verificabilidad) },
            ]
          : undefined,
      });
      continue;
    }

    // Regular dimensions (Claridad, Estructura, Persuasión, Adaptación)
    const base = dim as DimensionBase;
    if (!base.hallazgos || base.hallazgos.length === 0) continue;

    sections.push({
      key: dimKey,
      title: DIMENSION_LABELS[dimKey] ?? dimKey,
      queMide: base.que_mide || FALLBACK_QUE_MIDE[dimKey],
      score: base.puntaje,
      tuResultado: base.tu_resultado,
      hallazgos: base.hallazgos,
    });
  }

  if (sections.length === 0) return null;

  return (
    <div>
      <h3 className="text-base font-bold text-foreground mb-1">Hallazgos por Dimensión</h3>
      <p className="text-sm text-muted-foreground mb-5">
        Evidencia concreta de tu comunicación, organizada por área.
      </p>

      <div>
        {sections.map((section, i) => (
          <div key={section.key}>
            {i > 0 && <hr className="border-border my-6" />}
            <DimensionCard section={section} />
          </div>
        ))}
      </div>
    </div>
  );
}
