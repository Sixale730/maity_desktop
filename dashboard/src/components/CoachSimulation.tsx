import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardHeader, CardTitle } from './Card';
import { Expandable } from './Expandable';
import { simulations, type Simulation, type SimTurn, type SimSuggestion, type SimTrigger } from '../data/simulations';
import { SuggestionFeedback, PromptNotesPanel } from './FeedbackPanel';

const meetingTypeLabel: Record<string, { label: string; color: string }> = {
  sales: { label: 'Venta', color: 'bg-brand-500/10 text-brand-400' },
  service: { label: 'Servicio', color: 'bg-accent-amber/10 text-accent-amber' },
  webinar: { label: 'Webinar', color: 'bg-accent-purple/10 text-accent-purple' },
  team_meeting: { label: 'Equipo', color: 'bg-accent-cyan/10 text-accent-cyan' },
};

const verdictConfig: Record<string, { bg: string; text: string; label: string; icon: string }> = {
  correct: { bg: 'bg-accent-green/10', text: 'text-accent-green', label: 'Correcto', icon: '✓' },
  useful: { bg: 'bg-brand-500/10', text: 'text-brand-400', label: 'Util', icon: '◐' },
  neutral: { bg: 'bg-gray-500/10', text: 'text-gray-400', label: 'Neutral', icon: '—' },
  wrong: { bg: 'bg-accent-red/10', text: 'text-accent-red', label: 'Incorrecto', icon: '✕' },
};

const priorityDot: Record<string, string> = {
  critical: 'bg-accent-red',
  important: 'bg-accent-amber',
  soft: 'bg-gray-500',
};

export function CoachSimulation() {
  const [selectedSim, setSelectedSim] = useState<string>(simulations[0].id);
  const sim = simulations.find((s) => s.id === selectedSim)!;

  return (
    <div className="space-y-6">
      {/* Simulation Selector */}
      <div className="flex gap-3 flex-wrap">
        {simulations.map((s) => {
          const mt = meetingTypeLabel[s.meetingType];
          return (
            <button
              key={s.id}
              onClick={() => setSelectedSim(s.id)}
              className={`rounded-lg border px-4 py-3 text-left transition-all ${
                selectedSim === s.id
                  ? 'border-brand-500/50 bg-brand-500/10 shadow-lg shadow-brand-500/10'
                  : 'border-surface-3 bg-surface-1 hover:border-surface-4'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${mt.color}`}>
                  {mt.label}
                </span>
                <span className="text-[10px] text-gray-600">{s.duration}</span>
              </div>
              <p className="text-sm font-medium text-white">{s.title}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{s.turns.length} turnos · {s.suggestions.length} sugerencias</p>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={selectedSim}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          <SimulationDetail sim={sim} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function SimulationDetail({ sim }: { sim: Simulation }) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      {/* Column 1: Conversation */}
      <div className="xl:col-span-2">
        <Card delay={0.1}>
          <CardHeader>
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500/10">
              <svg className="h-3.5 w-3.5 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <CardTitle>Conversacion en Vivo</CardTitle>
            <span className="ml-auto text-[10px] text-gray-500">{sim.turns.length} turnos</span>
          </CardHeader>

          <p className="text-xs text-gray-500 mb-4">{sim.description}</p>

          <div className="space-y-2">
            {sim.turns.map((turn) => {
              const triggersAfter = sim.triggers.filter((t) => t.afterTurnId === turn.id);
              const suggestionsAfter = sim.suggestions.filter((s) => s.afterTurnId === turn.id);

              return (
                <div key={turn.id}>
                  <TurnBubble turn={turn} />
                  {/* Triggers + Suggestions inline */}
                  {(triggersAfter.length > 0 || suggestionsAfter.length > 0) && (
                    <div className="ml-8 mr-8 my-2 space-y-1.5">
                      {triggersAfter.map((trigger, i) => (
                        <TriggerBadge key={`t-${i}`} trigger={trigger} />
                      ))}
                      {suggestionsAfter.map((suggestion, i) => {
                        const globalIdx = sim.suggestions.indexOf(suggestion);
                        return <SuggestionCard key={`s-${i}`} suggestion={suggestion} simId={sim.id} suggestionIndex={globalIdx} />;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Column 2: Score + Stats + Feedback */}
      <div className="space-y-6">
        <ScoreCard sim={sim} />
        <SuggestionAccuracy sim={sim} />
        <PromptNotesPanel />
        <TechniqueBreakdown sim={sim} />
      </div>
    </div>
  );
}

function TurnBubble({ turn }: { turn: SimTurn }) {
  const isUser = turn.speaker === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`shrink-0 mt-1 h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
        isUser ? 'bg-brand-500/20 text-brand-400' : 'bg-accent-purple/20 text-accent-purple'
      }`}>
        {isUser ? 'TU' : 'CL'}
      </div>

      {/* Bubble */}
      <div className={`max-w-[80%] rounded-xl px-3.5 py-2.5 ${
        isUser
          ? 'bg-brand-500/10 border border-brand-500/20'
          : 'bg-surface-2 border border-surface-3'
      }`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-[10px] font-semibold ${isUser ? 'text-brand-400' : 'text-accent-purple'}`}>
            {isUser ? 'Usuario' : 'Cliente'}
          </span>
          <span className="text-[9px] font-mono text-gray-600">{turn.timestamp}</span>
        </div>
        <p className="text-xs text-gray-300 leading-relaxed">{turn.text}</p>
      </div>
    </div>
  );
}

function TriggerBadge({ trigger }: { trigger: SimTrigger }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-surface-0/80 border border-surface-3 px-2.5 py-1.5">
      <span className={`h-2 w-2 rounded-full ${priorityDot[trigger.priority]}`} />
      <svg className="h-3 w-3 text-accent-amber shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
      <span className="text-[10px] text-gray-500">
        <span className="font-semibold text-accent-amber">{trigger.category}</span>
        {' · '}{trigger.signal.replace(/_/g, ' ')}
        {' · '}<span className="text-gray-600">"{trigger.snippet}"</span>
      </span>
    </div>
  );
}

function SuggestionCard({ suggestion, simId, suggestionIndex }: { suggestion: SimSuggestion; simId: string; suggestionIndex: number }) {
  const verdict = verdictConfig[suggestion.verdict];

  return (
    <Expandable
      title={suggestion.tip}
      subtitle={`${suggestion.technique || suggestion.category} · ${suggestion.latencyMs}ms · conf ${(suggestion.confidence * 100).toFixed(0)}%`}
      badge={
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${verdict.bg} ${verdict.text}`}>
          {verdict.icon} {verdict.label}
        </span>
      }
    >
      {/* Verdict explanation */}
      <div className={`rounded-md p-2.5 mb-2 ${verdict.bg}`}>
        <p className={`text-xs leading-relaxed ${verdict.text}`}>
          {suggestion.verdictNote}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div>
          <span className="text-gray-600 uppercase">Categoria</span>
          <p className="font-mono text-gray-300">{suggestion.category}</p>
        </div>
        {suggestion.subcategory && (
          <div>
            <span className="text-gray-600 uppercase">Subcategoria</span>
            <p className="font-mono text-gray-300">{suggestion.subcategory.replace(/_/g, ' ')}</p>
          </div>
        )}
        {suggestion.technique && (
          <div>
            <span className="text-gray-600 uppercase">Tecnica/Framework</span>
            <p className="font-mono text-gray-300">{suggestion.technique}</p>
          </div>
        )}
        <div>
          <span className="text-gray-600 uppercase">Prioridad</span>
          <div className="flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${priorityDot[suggestion.priority]}`} />
            <span className="font-mono text-gray-300">{suggestion.priority}</span>
          </div>
        </div>
      </div>

      {/* Feedback widget */}
      <SuggestionFeedback
        simulationId={simId}
        suggestionIndex={suggestionIndex}
        suggestionTip={suggestion.tip}
      />
    </Expandable>
  );
}

function ScoreCard({ sim }: { sim: Simulation }) {
  const { finalScore } = sim;
  const scores = [
    { label: 'Overall', value: finalScore.overall, max: 10 },
    { label: 'Claridad', value: finalScore.clarity, max: 10 },
    { label: 'Engagement', value: finalScore.engagement, max: 10 },
    { label: 'Estructura', value: finalScore.structure, max: 10 },
  ];

  return (
    <Card delay={0.15}>
      <CardHeader>
        <CardTitle>Evaluacion Post-Llamada</CardTitle>
      </CardHeader>

      {/* Overall score big */}
      <div className="flex items-center justify-center mb-4">
        <div className="relative h-28 w-28">
          <svg className="h-28 w-28 -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" className="text-surface-3" strokeWidth="8" />
            <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor"
              className={finalScore.overall >= 8 ? 'text-accent-green' : finalScore.overall >= 6 ? 'text-accent-amber' : 'text-accent-red'}
              strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${(finalScore.overall / 10) * 314.16} 314.16`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-white">{finalScore.overall}</span>
            <span className="text-[9px] uppercase tracking-wider text-gray-500">/10</span>
          </div>
        </div>
      </div>

      {/* Sub-scores */}
      <div className="space-y-2">
        {scores.slice(1).map((s) => (
          <div key={s.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-gray-500">{s.label}</span>
              <span className="text-xs font-mono font-semibold text-gray-300">{s.value}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className={`h-full rounded-full ${s.value >= 8 ? 'bg-accent-green' : s.value >= 6 ? 'bg-accent-amber' : 'bg-accent-red'}`}
                style={{ width: `${(s.value / s.max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Strengths */}
      <div className="mt-4">
        <h5 className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Fortalezas</h5>
        <div className="space-y-1">
          {finalScore.strengths.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-accent-green/80">
              <span className="mt-1 shrink-0">+</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Improvements */}
      <div className="mt-3">
        <h5 className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Areas de Mejora</h5>
        <div className="space-y-1">
          {finalScore.areasToImprove.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-accent-amber/80">
              <span className="mt-1 shrink-0">-</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function SuggestionAccuracy({ sim }: { sim: Simulation }) {
  const total = sim.suggestions.length;
  const correct = sim.suggestions.filter((s) => s.verdict === 'correct').length;
  const useful = sim.suggestions.filter((s) => s.verdict === 'useful').length;
  const neutral = sim.suggestions.filter((s) => s.verdict === 'neutral').length;
  const wrong = sim.suggestions.filter((s) => s.verdict === 'wrong').length;

  const accuracy = Math.round(((correct + useful) / total) * 100);

  const bars = [
    { label: 'Correcto', count: correct, color: 'bg-accent-green' },
    { label: 'Util', count: useful, color: 'bg-brand-500' },
    { label: 'Neutral', count: neutral, color: 'bg-gray-500' },
    { label: 'Incorrecto', count: wrong, color: 'bg-accent-red' },
  ];

  return (
    <Card delay={0.2}>
      <CardHeader>
        <CardTitle>Precision del Coach</CardTitle>
        <span className="ml-auto rounded-full bg-accent-green/10 px-2 py-0.5 text-[10px] font-bold text-accent-green">
          {accuracy}%
        </span>
      </CardHeader>

      <div className="space-y-2">
        {bars.map((bar) => (
          <div key={bar.label} className="flex items-center gap-3">
            <span className="text-[10px] text-gray-500 w-16">{bar.label}</span>
            <div className="flex-1 h-4 overflow-hidden rounded bg-surface-3 flex items-center">
              <div
                className={`h-full ${bar.color} rounded flex items-center justify-center`}
                style={{ width: `${total > 0 ? (bar.count / total) * 100 : 0}%`, minWidth: bar.count > 0 ? '20px' : '0' }}
              >
                {bar.count > 0 && <span className="text-[9px] font-bold text-white">{bar.count}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 text-center">
        <span className="text-[10px] text-gray-600">
          {correct + useful} de {total} sugerencias accionables
        </span>
      </div>
    </Card>
  );
}

function TechniqueBreakdown({ sim }: { sim: Simulation }) {
  const techniques: Record<string, number> = {};
  sim.suggestions.forEach((s) => {
    const t = s.technique || 'General';
    techniques[t] = (techniques[t] || 0) + 1;
  });

  return (
    <Card delay={0.25}>
      <CardHeader>
        <CardTitle>Frameworks Aplicados</CardTitle>
      </CardHeader>
      <div className="space-y-2">
        {Object.entries(techniques)
          .sort((a, b) => b[1] - a[1])
          .map(([tech, count]) => (
            <div key={tech} className="flex items-center justify-between rounded-md bg-surface-2/50 border border-surface-3 px-3 py-2">
              <span className="text-xs font-medium text-white">{tech}</span>
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  {Array.from({ length: count }).map((_, i) => (
                    <div key={i} className="h-2 w-2 rounded-full bg-brand-500" />
                  ))}
                </div>
                <span className="text-[10px] font-mono text-gray-500">{count}x</span>
              </div>
            </div>
          ))}
      </div>

      <div className="mt-3 rounded-md bg-surface-0/80 p-2.5">
        <p className="text-[10px] text-gray-600 leading-relaxed">
          Modelo: <span className="font-mono text-gray-400">{sim.model}</span>
          {' · '}Latencia promedio: <span className="font-mono text-gray-400">
            {Math.round(sim.suggestions.reduce((sum, s) => sum + s.latencyMs, 0) / sim.suggestions.length)}ms
          </span>
        </p>
      </div>
    </Card>
  );
}
