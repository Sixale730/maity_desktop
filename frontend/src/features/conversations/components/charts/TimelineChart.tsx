'use client';

import type { MeetingTimeline, MeetingMeta } from '../../services/conversations.service';

const SPEAKER_COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4'];

interface TimelineChartProps {
  timeline: MeetingTimeline;
  meta: MeetingMeta;
}

export function TimelineChart({ timeline, meta }: TimelineChartProps) {
  const hablantes = meta.hablantes;
  const colorMap: Record<string, string> = {};

  hablantes.forEach((speaker, i) => {
    const color = SPEAKER_COLORS[i % SPEAKER_COLORS.length];
    colorMap[speaker] = `${color}8c`;
    colorMap[speaker.toLowerCase()] = `${color}8c`;
  });
  colorMap['dialogo'] = 'rgba(34,197,94,0.55)';
  colorMap['diálogo'] = 'rgba(34,197,94,0.55)';

  const tipoSet = new Set<string>();
  timeline.segmentos.forEach((s) => tipoSet.add(s.tipo));
  const tipos = Array.from(tipoSet);

  const dur = meta.duracion_minutos;
  const markers = dur > 0
    ? ['0:00', `${Math.round(dur * 0.25)}:00`, `${Math.round(dur * 0.5)}:00`, `${Math.round(dur * 0.75)}:00`, `${dur}:00`]
    : [];

  const pcts: Record<string, number> = {};
  timeline.segmentos.forEach((s) => { pcts[s.tipo] = (pcts[s.tipo] || 0) + s.pct; });

  return (
    <div>
      {/* Timeline bar */}
      <div className="flex h-9 rounded-lg overflow-hidden" style={{ boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.05)' }}>
        {timeline.segmentos.map((seg, i) => (
          <div
            key={i}
            className="h-full hover:opacity-80 transition-opacity"
            style={{
              width: `${seg.pct}%`,
              backgroundColor: colorMap[seg.tipo] || colorMap[seg.tipo.toLowerCase()] || 'rgba(100,100,100,0.55)',
            }}
            title={seg.descripcion || `${seg.tipo.charAt(0).toUpperCase() + seg.tipo.slice(1)} (${seg.pct}%)`}
          />
        ))}
      </div>

      {/* Time markers */}
      {markers.length > 0 && (
        <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
          {markers.map((m) => <span key={m}>{m}</span>)}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-2.5 text-sm">
        {tipos.map((tipo) => {
          const color = colorMap[tipo] || colorMap[tipo.toLowerCase()] || 'rgba(100,100,100,0.55)';
          const pct = Math.round(pcts[tipo] || 0);
          const label = tipo.toLowerCase() === 'dialogo' || tipo.toLowerCase() === 'diálogo'
            ? 'Diálogo real'
            : tipo.charAt(0).toUpperCase() + tipo.slice(1) + ' habla';
          return (
            <div key={tipo} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: color }} />
              <span className="text-foreground">{label}</span>
              <span className="text-muted-foreground">({pct}%)</span>
            </div>
          );
        })}
      </div>

      {/* Key moments */}
      {timeline.momentos_clave.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {[...timeline.momentos_clave].sort((a, b) => b.minuto - a.minuto).map((m) => (
            <span
              key={m.nombre}
              className="inline-flex items-center gap-1 bg-yellow-500/20 px-2.5 py-1 rounded-full text-xs font-semibold text-yellow-200"
            >
              {m.nombre} (min {m.minuto})
            </span>
          ))}
        </div>
      )}

      {timeline.lectura && (
        <div className="bg-blue-500/10 rounded-lg p-3 text-sm mt-3">
          <strong>Lectura:</strong> {timeline.lectura}
        </div>
      )}
    </div>
  );
}
