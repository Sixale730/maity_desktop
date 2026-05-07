'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useGamifiedDashboardDataV2 } from '../hooks/useGamifiedDashboardDataV2';
import { useProgressChartsData } from '../hooks/useProgressChartsData';
import { useFormResponsesRadar } from '../hooks/useFormResponsesRadar';
import { Card } from '@/components/ui/card';
import { RadarChartV2, type RadarSeriesPoint } from './RadarChartV2';
import {
  AreaChart, Area, ResponsiveContainer, YAxis,
  XAxis, CartesianGrid, Tooltip,
} from 'recharts';
import {
  Zap, Flame,
  Crown, Swords,
  TrendingUp, Target, Sparkles,
  Award,
} from 'lucide-react';

// ============================================================================
// CONSTANTS (idénticas al web)
// ============================================================================

const COMPETENCY_TO_DIM: Record<string, string> = {
  'Claridad':   'Claridad',
  'Estructura': 'Estructura',
  'Empatía':    'Empatía',
  'Adaptación': 'Adaptación',
  'Persuasión': 'Vocabulario',
  'Propósito':  'Objetivo',
};

const GENERIC_TIPS = [
  {
    num: 1,
    title: 'Estructura tus mensajes',
    desc: 'Antes de hablar, define 3 puntos clave que quieres comunicar. Usa la estructura: contexto → mensaje principal → acción esperada.',
    meta: 'Impacto: Claridad y Estructura',
    accent: 'hsl(var(--maity-blue))',
  },
  {
    num: 2,
    title: 'Reduce muletillas con pausas',
    desc: 'Sustituye los "este", "o sea" y "bueno" por pausas breves de silencio. Graba 1 minuto de habla diario y cuenta tus muletillas para ganar conciencia.',
    meta: 'Impacto: Credibilidad y fluidez verbal',
    accent: '#f97316',
  },
  {
    num: 3,
    title: 'Convierte ideas en acciones concretas',
    desc: 'Cada vez que digas "hay que hacer X", reformula a "[Nombre] hace [X] para [fecha]". Esto mejora tu orientación a objetivo y tu liderazgo.',
    meta: 'Impacto: Objetivo y Persuasión',
    accent: '#ffd93d',
  },
  {
    num: 4,
    title: 'Practica la escucha activa',
    desc: 'Antes de responder, parafrasea lo que dijo la otra persona. Esto demuestra empatía, evita malentendidos y mejora la calidad de la conversación.',
    meta: 'Impacto: Empatía y Adaptación',
    accent: 'hsl(var(--accent))',
  },
];

// ============================================================================
// REUSABLE COMPONENTS
// ============================================================================

const ProgressBar = ({ value, max = 100, color = 'hsl(var(--maity-blue))', height = 'h-2', glow = false }: {
  value: number;
  max?: number;
  color?: string;
  height?: string;
  glow?: boolean;
}) => (
  <div className={`w-full bg-[#1a1a2e] rounded-full overflow-hidden ${height}`}>
    <div
      className="h-full rounded-full transition-all duration-1000 ease-out"
      style={{
        width: `${(value / max) * 100}%`,
        backgroundColor: color,
        boxShadow: glow ? `0 0 10px ${color}60` : 'none'
      }}
    />
  </div>
);

const LetterAvatar = ({ name }: { name: string }) => {
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="w-full h-full rounded-full bg-gradient-to-br from-[#485df4] to-[#9b4dca] flex items-center justify-center">
      <span className="text-2xl font-bold text-white">{initials || '?'}</span>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT (clon del web — solo imports/hooks adaptados)
// ============================================================================

export function GamifiedDashboardV2() {
  const router = useRouter();
  const { maityUser } = useAuth();
  const data = useGamifiedDashboardDataV2();
  const { radarData, sessionHistory } = useProgressChartsData(data.conversations);
  const { radarData: selfAssessmentData } = useFormResponsesRadar();

  const firstName = maityUser?.first_name || 'Usuario';

  // Communication trend: real session global scores in chronological order
  const communicationTrend = useMemo(() => {
    if (!sessionHistory.length) return [];
    return [...sessionHistory].reverse().map(row => ({
      fecha: row.fecha,
      score: row.global,
    }));
  }, [sessionHistory]);

  // Build enriched radar data: each competency carries s1/s6/auto
  const enrichedRadarData = useMemo<RadarSeriesPoint[]>(() => {
    return data.competencies.map((comp) => {
      const dimKey = COMPETENCY_TO_DIM[comp.name] ?? comp.name;
      const aiMatch = radarData.find(r => r.dim === dimKey);
      const autoMatch = selfAssessmentData.find(sa => sa.competencia === comp.name);
      return {
        name: comp.name,
        color: comp.color,
        s1: aiMatch?.s1 ?? 0,
        s6: aiMatch?.s6 ?? 0,
        auto: autoMatch?.usuario ?? comp.value ?? 0,
      };
    });
  }, [data.competencies, radarData, selfAssessmentData]);

  if (data.loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-500" />
      </div>
    );
  }

  // Find strongest and weakest competency (based on autoevaluation, as before)
  const strongest = data.competencies.length > 0
    ? data.competencies.reduce((max, c) => c.value > max.value ? c : max, data.competencies[0])
    : { name: '—', value: 0, color: '#485df4' };
  const weakest = data.competencies.length > 0
    ? data.competencies.reduce((min, c) => c.value < min.value ? c : min, data.competencies[0])
    : { name: '—', value: 0, color: '#ef4444' };

  // Calculate XP progress percentage
  const xpProgress = Math.min((data.xp / data.nextLevelXP) * 100, 100);

  return (
    <div className="max-w-[1500px] mx-auto p-6 pb-28 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ================================================================== */}
      {/* HEADER: Avatar + Greeting + Stats */}
      {/* ================================================================== */}
      <div className="flex flex-row justify-between items-center mb-8 gap-6">
        {/* Left: Avatar + Greeting */}
        <div className="flex items-center gap-5">
          {/* Avatar */}
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#ff0050] to-[#485df4] p-1 shadow-lg shadow-pink-500/20">
              <div className="w-full h-full rounded-full bg-[#0a0a12] overflow-hidden flex items-center justify-center">
                <LetterAvatar name={firstName} />
              </div>
            </div>
            {/* Level badge */}
            <div className="absolute -bottom-1 -right-1 bg-[#485df4] text-white text-xs font-bold px-2 py-0.5 rounded-full border-2 border-[#0a0a12]">
              Lv.{data.level}
            </div>
          </div>

          {/* Greeting */}
          <div>
            <h1 className="text-3xl font-bold text-white mb-1">
              Hola, {firstName}! <span className="inline-block animate-pulse">👋</span>
            </h1>
            <p className="text-gray-400 text-sm">
              <span className="text-[#1bea9a] font-semibold">{data.rank}</span> • {data.xp} / {data.nextLevelXP} XP
            </p>
            {/* XP Progress Bar */}
            <div className="mt-2 w-48">
              <ProgressBar value={xpProgress} color="#ff0050" height="h-1.5" glow />
            </div>
          </div>
        </div>

        {/* Right: Quick Stats */}
        <div className="flex gap-3">
          {/* Streak */}
          <div className="flex items-center gap-3 bg-gradient-to-r from-orange-500/10 to-red-500/10 px-5 py-3 rounded-2xl border border-orange-500/20">
            <div className="p-2 bg-orange-500/20 rounded-xl">
              <Flame size={22} className="text-orange-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{data.streak}</div>
              <div className="text-[10px] text-orange-400 uppercase font-bold tracking-wider">Días Racha</div>
            </div>
          </div>

          {/* XP */}
          <div className="flex items-center gap-3 bg-gradient-to-r from-pink-500/10 to-purple-500/10 px-5 py-3 rounded-2xl border border-pink-500/20">
            <div className="p-2 bg-pink-500/20 rounded-xl">
              <Zap size={22} className="text-pink-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{data.xp}</div>
              <div className="text-[10px] text-pink-400 uppercase font-bold tracking-wider">XP Total</div>
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* MAIN GRID: Mission + Communication Trend (left) | Radar + Ranking (right) */}
      {/* ================================================================== */}
      <div className="flex gap-6 mb-6">

        {/* LEFT: Mission + Communication Trend */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          {/* Mission Card — HÍBRIDO: imagen full-width del card (sin borde físico de wrapper) + cartel der con su propio bg sólido que tapa la imagen detrás.
              Combina lo mejor del patrón web (gradient simétrico cinematográfico) sin el problema del overflow-hidden side-by-side.
              Como el gradient termina en to-[#0F0F0F] y el cartel der tiene bg-[#0F0F0F], la transición es visualmente invisible. */}
          <Card className="relative overflow-hidden border-2 border-pink-500/20 hover:border-pink-500/40 transition-all bg-[#0F0F0F] group">
            {/* IMAGEN: cubre TODO el card, no encerrada en w-1/2 */}
            <img
              src="/images/mission-mountain.jpg"
              alt=""
              className="absolute inset-0 w-full h-full object-cover object-[center_30%] group-hover:scale-105 transition-transform duration-700"
            />
            {/* GRADIENT WEB simétrico: oscuro-claro-card */}
            <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-[#0F0F0F]" />

            <div className="relative flex min-h-[320px]">
              {/* IZQ: texto Misión Actual + título sobre la imagen (sin bg, transparente) */}
              <div className="w-1/2 flex flex-col justify-end p-5">
                <div className="flex items-center gap-2 text-pink-500 font-bold tracking-widest uppercase text-xs mb-1 drop-shadow-lg">
                  <Swords size={14} /> Misión Actual
                </div>
                <h2 className="text-3xl font-bold text-white leading-tight drop-shadow-lg">
                  {data.mission.map}
                </h2>
              </div>

              {/* DER: cartel + progreso — bg-[#0F0F0F] PROPIO para tapar la imagen detrás (sin esto se vería translúcido) */}
              <div className="w-1/2 bg-[#0F0F0F] p-5 flex flex-col justify-between gap-4">
                {/* TOP: solo badge 30 días alineado a la derecha */}
                <div className="flex items-center justify-end">
                  <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-full border border-white/10">
                    <span className="text-yellow-500 text-xs">📅</span>
                    <span className="text-xs text-white font-medium">30 días</span>
                  </div>
                </div>

                {/* MEDIO: Enemigo Final full width */}
                <div className="flex items-center gap-3 bg-black/40 px-4 py-3 rounded-xl border border-red-500/30">
                  <span className="text-4xl">{data.mission.enemyIcon}</span>
                  <div className="min-w-0">
                    <div className="text-[10px] text-red-400 uppercase font-bold tracking-wider mb-0.5">
                      ⚔️ Enemigo Final
                    </div>
                    <div className="text-white font-bold text-base leading-tight">{data.mission.enemy}</div>
                    <div className="text-xs text-gray-400 truncate">{data.mission.enemyDesc}</div>
                  </div>
                </div>

                {/* BOTTOM: progreso */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <span className="text-gray-300 flex items-center gap-1.5">
                      <span>🗺️</span> Día {Math.ceil(data.mission.progress * 0.3)} de 30
                    </span>
                    <span className="text-pink-400 font-bold text-sm">{data.mission.progress}%</span>
                  </div>
                  <ProgressBar value={data.mission.progress} color="#ff0050" height="h-2.5" glow />
                </div>
              </div>
            </div>
          </Card>

          {/* Cómo va tu Comunicación — debajo de Misión, columna izq.
              4 estados según cantidad de conversaciones analizadas:
              A) sin grabaciones → invitar a grabar
              B) grabadas pero análisis pendiente → "Analizando..."
              C) 1 conversación analizada → mostrar score grande + invitar a grabar otra
              D) 2+ conversaciones analizadas → AreaChart de tendencia */}
          {data.conversations.length === 0 ? (
            /* A: empty state grabar */
            <Card className="p-8 bg-[#0F0F0F] border border-white/10 flex-1 flex flex-col items-center justify-center text-center min-h-[280px]">
              <div className="w-16 h-16 rounded-2xl bg-pink-500/10 flex items-center justify-center mb-4">
                <Sparkles size={28} className="text-pink-500" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Empieza tu primera conversación</h3>
              <p className="text-sm text-gray-400 max-w-sm mb-6">
                Tu progreso de comunicación aparecerá aquí cuando analices tu primera grabación.
              </p>
              <button
                onClick={() => router.push('/')}
                className="bg-gradient-to-r from-[#ff0050] to-[#485df4] hover:opacity-90 text-white font-bold px-6 py-3 rounded-xl shadow-lg shadow-pink-500/30 hover:-translate-y-0.5 transition-all flex items-center gap-2"
              >
                <Sparkles size={18} /> Empezar a grabar
              </button>
            </Card>
          ) : communicationTrend.length === 0 ? (
            /* B: hay grabaciones pero ninguna analizada todavía — mensaje estático (NO spinner: el estado no es "procesando" en este momento, es solo "análisis pendiente del lado cloud") */
            <Card className="p-8 bg-[#0F0F0F] border border-white/10 flex-1 flex flex-col items-center justify-center text-center min-h-[280px]">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                <Award size={28} className="text-gray-500" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Tu primera puntuación aparecerá aquí</h3>
              <p className="text-sm text-gray-400 max-w-sm">
                Cuando termine el análisis de tu conversación verás tu score, y con una segunda grabación se desbloquea tu gráfica de tendencia.
              </p>
            </Card>
          ) : communicationTrend.length === 1 ? (
            /* C: primera puntuación — score grande + milestone progress 1/2 (patrón Duolingo/Strava) */
            <Card className="p-8 bg-[#0F0F0F] border border-white/10 flex-1 flex flex-col items-center justify-center text-center min-h-[280px]">
              <div className="flex items-center gap-2 text-pink-500 font-bold tracking-widest uppercase text-xs mb-2">
                <Award size={14} /> Tu primera puntuación
              </div>
              <div className="text-7xl font-black text-white leading-none mb-1">
                {communicationTrend[0].score}
              </div>
              <div className="text-sm text-gray-500 mb-5">de 100</div>

              {/* Milestone progress: convierte "no hay suficientes datos" en un objetivo desbloqueable */}
              <div className="w-full max-w-xs mb-5">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-400">Gráfica de tendencia</span>
                  <span className="text-pink-400 font-bold">1 / 2</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full w-1/2 bg-gradient-to-r from-[#ff0050] to-[#485df4] rounded-full" />
                </div>
              </div>

              <p className="text-sm text-gray-400 max-w-sm mb-6">
                Graba 1 conversación más para desbloquear tu gráfica de tendencia.
              </p>
              <button
                onClick={() => router.push('/')}
                className="bg-gradient-to-r from-[#ff0050] to-[#485df4] hover:opacity-90 text-white font-bold px-6 py-3 rounded-xl shadow-lg shadow-pink-500/30 hover:-translate-y-0.5 transition-all flex items-center gap-2"
              >
                <Sparkles size={18} /> Grabar otra
              </button>
            </Card>
          ) : (
            /* D: AreaChart con 2+ puntos */
            <Card className="p-5 bg-[#0F0F0F] border border-white/10 flex-1 flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-white flex items-center gap-2">
                    <TrendingUp size={18} className="text-pink-500" />
                    Cómo va tu Comunicación
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Calificación de tus últimas conversaciones
                  </p>
                </div>
                <span className="text-xs text-gray-500">
                  {communicationTrend.length} más recientes
                </span>
              </div>
              <div className="flex-1 min-h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={communicationTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="commTrendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ec4899" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#ec4899" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1a1a2e" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#141418', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#a0a0b0' }}
                      itemStyle={{ color: '#fff' }}
                      formatter={(v) => [typeof v === 'number' ? v : 0, 'Score']}
                    />
                    <Area
                      type="monotone"
                      dataKey="score"
                      stroke="#ec4899"
                      strokeWidth={2.5}
                      fill="url(#commTrendGrad)"
                      dot={{ r: 5, fill: '#0a0a12', stroke: '#ec4899', strokeWidth: 2 }}
                      activeDot={{ r: 7, fill: '#ec4899', stroke: '#fff', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </div>{/* /flex-1 izq columna principal */}

        {/* RIGHT: Radar + Ranking — w-[460px] da más respiro horizontal (ver CLAUDE.md §"Patron Visual: Dashboard de Gamificacion") */}
        <div className="w-[460px] shrink-0 flex flex-col gap-6">
          {/* Radar Card */}
          <Card className="p-4 bg-[#0F0F0F] border border-white/10 hover:border-blue-500/30 transition-colors">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Target size={16} className="text-blue-400" /> Tu Radar: IA vs Autoevaluación
              </h3>
            </div>
            <div className="flex justify-center -mx-2">
              <RadarChartV2 data={enrichedRadarData} size={260} />
            </div>
            <div className="pt-2 border-t border-white/5 grid grid-cols-2 gap-2 text-xs">
              <div className="bg-green-500/10 rounded-lg p-2 text-center">
                <span className="text-gray-500 block mb-1">💪 Fortaleza</span>
                <span className="text-green-400 font-bold">{strongest.name}</span>
              </div>
              <div className="bg-pink-500/10 rounded-lg p-2 text-center">
                <span className="text-gray-500 block mb-1">🎯 Mejorar</span>
                <span className="text-pink-400 font-bold">{weakest.name}</span>
              </div>
            </div>
          </Card>

          {/* Ranking Card — debajo del Radar en columna der */}
          <Card className="p-5 bg-[#0F0F0F] border border-white/10 flex-1">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <Crown size={18} className="text-yellow-500" /> Ranking
            </h3>
            <div className="space-y-2">
              {data.ranking.map((entry, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between p-2.5 rounded-xl transition-all ${
                    entry.isCurrentUser
                      ? 'bg-white/[0.06] border border-white/10'
                      : 'bg-[#141418] hover:bg-[#1a1a22]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-[#1a1a2e] text-gray-500">
                      {entry.position <= 3 ? (
                        entry.position === 1 ? '🥇' : entry.position === 2 ? '🥈' : '🥉'
                      ) : entry.position}
                    </div>
                    <span className={`font-medium text-sm ${entry.isCurrentUser ? 'text-white' : 'text-gray-300'}`}>
                      {entry.name}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 font-mono">
                    {entry.xp >= 1000 ? `${(entry.xp / 1000).toFixed(1)}K` : entry.xp}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* ================================================================== */}
      {/* COMMUNICATION TIPS (4 cards, full width) */}
      {/* ================================================================== */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-[10px] font-bold uppercase tracking-[3px] text-gray-500">
            Tips de Comunicación
          </span>
          <div className="h-px flex-1 bg-white/10" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {GENERIC_TIPS.map((tip) => (
            <Card
              key={tip.num}
              className="p-4 bg-[#0F0F0F] border border-white/10 border-t-4 flex flex-col gap-2"
              style={{ borderTopColor: `${tip.accent}50` }}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-base font-extrabold"
                style={{ backgroundColor: `${tip.accent}10`, color: tip.accent }}
              >
                {tip.num}
              </div>
              <h4 className="text-sm font-bold text-white">{tip.title}</h4>
              <p className="text-xs text-gray-400 leading-relaxed flex-1">{tip.desc}</p>
              <p className="text-[10px] text-gray-600 uppercase tracking-wider">{tip.meta}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default GamifiedDashboardV2;
