'use client';

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { SpeakerEmotion } from '../../services/conversations.service';

const SPEAKER_COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4'];
const EMO_LABELS = ['Alegría', 'Confianza', 'Miedo', 'Sorpresa', 'Tristeza', 'Disgusto', 'Ira', 'Anticipación'];
const EMO_KEYS = ['alegria', 'confianza', 'miedo', 'sorpresa', 'tristeza', 'disgusto', 'ira', 'anticipacion'] as const;

const GRID_STROKE = 'rgba(255,255,255,0.1)';
const TICK_STYLE = { fill: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 600 };
const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' },
  itemStyle: { color: '#fff' },
  labelStyle: { color: 'rgba(255,255,255,0.7)' },
};

interface EmotionRadarChartProps {
  porHablante: Record<string, SpeakerEmotion>;
  hablantes: string[];
  speakerNameMap?: Record<string, string>;
}

function getEmotionValue(data: SpeakerEmotion, key: typeof EMO_KEYS[number]): number {
  return data[key] ?? 0;
}

export function EmotionRadarChart({ porHablante, hablantes, speakerNameMap = {} }: EmotionRadarChartProps) {
  const speakers = Object.keys(porHablante);

  const chartData = EMO_LABELS.map((label, i) => {
    const row: Record<string, string | number> = { label };
    for (const speaker of speakers) {
      row[speaker] = porHablante[speaker] ? getEmotionValue(porHablante[speaker], EMO_KEYS[i]) : 0;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={380}>
      <RadarChart data={chartData}>
        <PolarGrid stroke={GRID_STROKE} />
        <PolarAngleAxis dataKey="label" tick={TICK_STYLE} />
        <PolarRadiusAxis domain={[0, 1]} tickCount={5} tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
        {speakers.map((speaker) => {
          const idx = hablantes.indexOf(speaker);
          const color = SPEAKER_COLORS[(idx >= 0 ? idx : speakers.indexOf(speaker)) % SPEAKER_COLORS.length];
          return (
            <Radar
              key={speaker}
              name={speakerNameMap[speaker] || speaker}
              dataKey={speaker}
              stroke={color}
              fill={color}
              fillOpacity={0.12}
              strokeWidth={2}
            />
          );
        })}
        <Legend iconSize={12} wrapperStyle={{ fontSize: 12, paddingTop: 8, color: 'rgba(255,255,255,0.7)' }} />
        <Tooltip {...TOOLTIP_STYLE} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

interface MiniRadarProps {
  speakerData: SpeakerEmotion;
  color: string;
}

export function MiniRadar({ speakerData, color }: MiniRadarProps) {
  const data = EMO_LABELS.map((label, i) => ({
    label,
    value: getEmotionValue(speakerData, EMO_KEYS[i]),
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <RadarChart data={data}>
        <PolarGrid stroke={GRID_STROKE} />
        <PolarAngleAxis dataKey="label" tick={{ ...TICK_STYLE, fontSize: 10 }} />
        <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
        <Radar dataKey="value" stroke={color} fill={color} fillOpacity={0.15} strokeWidth={2} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
