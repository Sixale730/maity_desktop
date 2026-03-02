'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useGamifiedDashboardDataV2 } from '../hooks/useGamifiedDashboardDataV2';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadarChartV2 } from './RadarChartV2';
import { ProgressChartsSection } from './ProgressChartsSection';
import {
  AreaChart, Area, ResponsiveContainer, YAxis,
} from 'recharts';
import {
  Zap, Flame, ArrowRight, ChevronRight,
  Activity, Crown, Swords,
  TrendingUp, TrendingDown, Target,
} from 'lucide-react';

// Sparkline data for global score evolution
const SCORE_SPARKLINE = [
  { v: 38 }, { v: 42 }, { v: 47 }, { v: 45 }, { v: 50 }, { v: 55 },
];

// ============================================================================
// REUSABLE COMPONENTS
// ============================================================================

const CircularScore = ({ value, label, color, size = 80 }: {
  value: number;
  label: string;
  color: string;
  size?: number;
}) => {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (value / 10) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="transform -rotate-90" width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1a1a2e" strokeWidth="6" />
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth="6"
            strokeLinecap="round" strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            className="transition-all duration-1000 ease-out"
            style={{ filter: `drop-shadow(0 0 6px ${color}40)` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-bold text-white">{value.toFixed(1)}</span>
        </div>
      </div>
      <span className="text-xs text-gray-500 mt-2 uppercase font-bold tracking-wider">{label}</span>
    </div>
  );
};

const ProgressBar = ({ value, max = 100, color = '#485df4', height = 'h-2', glow = false }: {
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

// Letter Avatar (replaces VoxelAvatar from web)
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
// MAIN COMPONENT
// ============================================================================

export function GamifiedDashboardV2() {
  const router = useRouter();
  const { maityUser } = useAuth();
  const data = useGamifiedDashboardDataV2();

  const firstName = maityUser?.first_name || 'Usuario';

  if (data.loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-10 h-10 border-2 border-[#ff0050] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const strongest = data.competencies.reduce((max, c) => c.value > max.value ? c : max, data.competencies[0]);
  const weakest = data.competencies.reduce((min, c) => c.value < min.value ? c : min, data.competencies[0]);
  const xpProgress = Math.min((data.xp / data.nextLevelXP) * 100, 100);

  return (
    <div className="max-w-[1500px] mx-auto p-4 lg:p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ================================================================== */}
      {/* HEADER: Avatar + Greeting + Stats */}
      {/* ================================================================== */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
        {/* Left: Avatar + Greeting */}
        <div className="flex items-center gap-5">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#ff0050] to-[#485df4] p-1 shadow-lg shadow-pink-500/20">
              <div className="w-full h-full rounded-full bg-[#0a0a12] overflow-hidden flex items-center justify-center">
                <LetterAvatar name={firstName} />
              </div>
            </div>
            <div className="absolute -bottom-1 -right-1 bg-[#485df4] text-white text-xs font-bold px-2 py-0.5 rounded-full border-2 border-[#0a0a12]">
              Lv.{data.level}
            </div>
          </div>

          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-white mb-1">
              Hola, {firstName}! <span className="inline-block animate-pulse">👋</span>
            </h1>
            <p className="text-gray-400 text-sm">
              <span className="text-[#1bea9a] font-semibold">{data.rank}</span> • {data.xp} / {data.nextLevelXP} XP
            </p>
            <div className="mt-2 w-48">
              <ProgressBar value={xpProgress} color="#ff0050" height="h-1.5" glow />
            </div>
          </div>
        </div>

        {/* Right: Quick Stats */}
        <div className="flex gap-3">
          <div className="flex items-center gap-3 bg-gradient-to-r from-orange-500/10 to-red-500/10 px-5 py-3 rounded-2xl border border-orange-500/20">
            <div className="p-2 bg-orange-500/20 rounded-xl">
              <Flame size={22} className="text-orange-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{data.streak}</div>
              <div className="text-[10px] text-orange-400 uppercase font-bold tracking-wider">Días Racha</div>
            </div>
          </div>

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
      {/* MAIN GRID: Mission + Radar + Score */}
      {/* ================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">

        {/* LEFT: Mission Card (8 cols) */}
        <div className="lg:col-span-8">
          <Card className="h-full relative overflow-hidden border-2 border-pink-500/20 hover:border-pink-500/40 transition-all bg-[#0F0F0F] group flex flex-col">
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent z-10" />
            <div
              className="absolute inset-0 bg-cover bg-bottom opacity-60 group-hover:opacity-70 group-hover:scale-105 transition-all duration-700"
              style={{ backgroundImage: "url('/images/mission-mountain.jpg')" }}
            />

            {/* Sparkline overlay */}
            <div className="absolute inset-0 z-[11] flex items-end pointer-events-none opacity-[0.12]">
              <div className="w-full h-[60%]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={SCORE_SPARKLINE} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <YAxis domain={[0, 100]} hide />
                    <defs>
                      <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ff0050" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#ff0050" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="v" stroke="#ff0050" strokeWidth={2} fill="url(#sparklineGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Content */}
            <div className="relative z-20 p-6 lg:p-8 flex-1">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-pink-500 font-bold tracking-widest uppercase text-xs">
                  <Swords size={14} /> Misión Actual
                </div>
                <div className="flex items-center gap-2 bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/10">
                  <span className="text-yellow-500">📅</span>
                  <span className="text-xs text-white font-medium">30 días</span>
                </div>
              </div>

              <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4 leading-tight drop-shadow-lg">
                {data.mission.map}
              </h2>

              <div className="inline-flex items-center gap-4 bg-black/60 backdrop-blur-sm px-4 py-3 rounded-2xl border border-red-500/30 mb-4 shadow-lg">
                <div className="text-5xl drop-shadow-lg">{data.mission.enemyIcon}</div>
                <div>
                  <div className="text-[10px] text-red-400 uppercase font-bold tracking-wider mb-0.5">⚔️ Enemigo Final</div>
                  <div className="text-white font-bold text-lg">{data.mission.enemy}</div>
                  <div className="text-xs text-gray-400">{data.mission.enemyDesc}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-gray-400 mr-1">🎒 Equipo:</span>
                {data.mission.items.map((item, i) => (
                  <span key={i} className="px-3 py-1.5 bg-black/40 backdrop-blur-sm rounded-full text-xs text-white border border-white/10 flex items-center gap-2">
                    <span className="text-base">{item.icon}</span> {item.name}
                  </span>
                ))}
              </div>
            </div>

            {/* Footer: Progress + CTA */}
            <div className="relative z-20 p-4 lg:px-8 lg:pb-6 bg-gradient-to-t from-black/90 to-transparent">
              <div className="mb-4">
                <div className="flex justify-between items-center text-xs mb-2">
                  <span className="text-gray-300 flex items-center gap-2">
                    <span className="text-lg">🗺️</span> Progreso del mapa
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 text-[10px]">Día {Math.ceil(data.mission.progress * 0.3)} de 30</span>
                    <span className="text-pink-400 font-bold text-sm">{data.mission.progress}%</span>
                  </div>
                </div>
                <div className="relative">
                  <ProgressBar value={data.mission.progress} color="#ff0050" height="h-3" glow />
                  <div className="absolute top-0 left-0 right-0 h-3 flex justify-between px-0.5 pointer-events-none">
                    {[0, 25, 50, 75, 100].map((mark) => (
                      <div key={mark} className={`w-0.5 h-full ${mark <= data.mission.progress ? 'bg-white/30' : 'bg-white/10'}`} />
                    ))}
                  </div>
                </div>
              </div>

              <Button
                onClick={() => router.push('/conversations')}
                className="w-full sm:w-auto bg-gradient-to-r from-[#ff0050] to-[#485df4] hover:opacity-90 text-white font-bold px-8 py-4 text-lg shadow-lg shadow-pink-500/30 hover:shadow-pink-500/50 hover:-translate-y-0.5 transition-all"
              >
                <Swords size={20} className="mr-2" /> Ver Conversaciones <ArrowRight size={20} className="ml-2" />
              </Button>
            </div>
          </Card>
        </div>

        {/* RIGHT: Radar + Score (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Radar Card */}
          <Card className="p-4 bg-[#0F0F0F] border border-white/10 hover:border-blue-500/30 transition-colors">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Target size={16} className="text-blue-400" /> Tu Radar
              </h3>
            </div>
            <div className="flex justify-center -mx-2">
              <RadarChartV2 data={data.competencies} size={260} />
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

          {/* Score Comparison Card */}
          <Card className="p-5 bg-[#0F0F0F] border border-white/10">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              {data.score.today >= data.score.yesterday ? (
                <TrendingUp size={18} className="text-green-400" />
              ) : (
                <TrendingDown size={18} className="text-red-400" />
              )}
              Score Diario
            </h3>
            <div className="flex items-center justify-center gap-8">
              <CircularScore value={data.score.yesterday} label="Ayer" color="#6b7280" size={70} />
              <div className="flex flex-col items-center">
                <div className={`text-2xl font-bold ${data.score.today >= data.score.yesterday ? 'text-green-400' : 'text-red-400'}`}>
                  {data.score.today >= data.score.yesterday ? '↑' : '↓'}
                </div>
                <div className={`text-sm font-bold ${data.score.today >= data.score.yesterday ? 'text-green-400' : 'text-red-400'}`}>
                  {data.score.today >= data.score.yesterday ? '+' : ''}{(data.score.today - data.score.yesterday).toFixed(1)}
                </div>
              </div>
              <CircularScore
                value={data.score.today}
                label="Hoy"
                color={data.score.today >= data.score.yesterday ? '#1bea9a' : '#ef4444'}
                size={70}
              />
            </div>
          </Card>
        </div>
      </div>

      {/* ================================================================== */}
      {/* BOTTOM GRID: Activity + Ranking */}
      {/* ================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Activity Card (2 cols) */}
        <Card className="p-5 lg:col-span-2 bg-[#0F0F0F] border border-white/10">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-white flex items-center gap-2">
              <Activity size={18} className="text-green-400" /> Actividad Reciente
            </h3>
            <button
              className="text-xs text-blue-400 hover:text-white transition-colors"
              onClick={() => router.push('/conversations')}
            >
              Ver todo →
            </button>
          </div>
          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
            {data.recentActivity.length > 0 ? (
              data.recentActivity.slice(0, 5).map((conv) => (
                <div
                  key={conv.id}
                  className="p-3 rounded-xl bg-[#141418] hover:bg-[#1a1a22] transition-all cursor-pointer border border-transparent hover:border-white/10 group"
                  onClick={() => router.push(`/conversations?id=${conv.id}`)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xl">{conv.emoji}</span>
                        <span className="text-xs font-bold text-gray-400">{conv.score}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white font-medium text-sm truncate">{conv.title}</span>
                          {conv.topSkill && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-white/5 text-gray-500 rounded whitespace-nowrap">
                              {conv.topSkill}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mb-1">{conv.date} • {conv.duration}</div>
                        {conv.insight && (
                          <p className="text-xs text-gray-400 leading-relaxed line-clamp-2 group-hover:text-gray-300 transition-colors">
                            {conv.insight}
                          </p>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-600 group-hover:text-white transition-colors flex-shrink-0 mt-1" />
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-10 text-gray-500">
                <Activity size={40} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium">Aún no tienes actividad</p>
                <p className="text-xs mt-1">¡Empieza una grabación para ver tus resultados!</p>
              </div>
            )}
          </div>
        </Card>

        {/* Ranking Card (1 col) */}
        <Card className="p-5 bg-[#0F0F0F] border border-white/10">
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

      {/* ================================================================== */}
      {/* PROGRESS CHARTS */}
      {/* ================================================================== */}
      <ProgressChartsSection conversations={data.conversations} formData={data.formData} />
    </div>
  );
}

export default GamifiedDashboardV2;
