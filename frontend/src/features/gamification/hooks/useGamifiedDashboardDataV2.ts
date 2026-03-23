import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  getOmiConversations,
  getOmiConversationDates,
  getFormResponses,
  OmiConversation,
  CommunicationFeedback,
  FormResponse,
} from '@/features/conversations/services/conversations.service';

export interface MountainNode {
  index: number;
  x: number;
  y: number;
  status: 'completed' | 'current' | 'locked';
}

export interface RankingEntry {
  position: number;
  name: string;
  xp: number;
  streak: number;
  isCurrentUser?: boolean;
}

export interface Badge {
  id: string;
  name: string;
  xp: number;
  icon: string;
  color: string;
  unlocked: boolean;
}

export interface Mission {
  name: string;
  enemy: string;
  enemyDesc: string;
  enemyIcon: string;
  items: { name: string; icon: string }[];
  progress: number;
}

export interface RecentActivity {
  id: string;
  title: string;
  date: string;
  duration: string;
  score: number;
  status: 'excellent' | 'good' | 'warning';
  insight?: string;
  topSkill?: string;
  emoji?: string;
}

export interface Competency {
  name: string;
  value: number;
  color: string;
}

export interface GamifiedDashboardDataV2 {
  userName: string;
  userRole: string;
  level: number;
  rank: string;
  totalXP: number;
  xp: number;
  nextLevelXP: number;
  streakDays: number;
  streak: number;
  bonusDays: number;
  score: { yesterday: number; today: number };
  nodes: MountainNode[];
  completedNodes: number;
  competencies: Competency[];
  mission: Mission & { map: string };
  badges: Badge[];
  analytics: {
    muletillasScore: number;
    flowScore: number;
    muletillas: number;
    flow: number;
  };
  ranking: RankingEntry[];
  recentActivity: RecentActivity[];
  conversations: OmiConversation[];
  formData: FormResponse | null;
  loading: boolean;
}

const NODE_POSITIONS: [number, number][] = [
  [20, 88], [40, 85], [60, 82], [80, 79],
  [70, 72], [50, 69], [30, 66],
  [40, 58], [60, 55],
  [50, 47], [35, 42], [65, 37],
  [50, 30], [45, 22], [55, 15],
];

const BADGE_DEFINITIONS: Omit<Badge, 'unlocked'>[] = [
  { id: '1', name: 'Negociador Valiente', xp: 50, icon: '\uD83D\uDEE1\uFE0F', color: '#3b82f6' },
  { id: '2', name: 'Precisión Verbal', xp: 90, icon: '\uD83C\uDFAF', color: '#ef4444' },
  { id: '3', name: 'Empático', xp: 50, icon: '\u2764\uFE0F', color: '#10b981' },
  { id: '4', name: 'Astucia Disruptiva', xp: 170, icon: '\uD83E\uDDE0', color: '#9333ea' },
  { id: '5', name: 'Orador Maestro', xp: 500, icon: '\uD83C\uDFA4', color: '#f59e0b' },
  { id: '6', name: 'Líder Nato', xp: 1000, icon: '\uD83D\uDC51', color: '#ec4899' },
];

const MOCK_MISSION: Mission = {
  name: 'Montaña de Fuego',
  enemy: 'EL REGATEADOR',
  enemyDesc: 'Escéptico, Ocupado, Orientado a datos',
  enemyIcon: '\uD83D\uDC79',
  items: [
    { name: 'Pico de Piedra', icon: '\u26CF\uFE0F' },
    { name: 'Casco de Lava', icon: '\u26D1\uFE0F' },
  ],
  progress: 35,
};

const COMPETENCY_COLORS: Record<string, string> = {
  'Claridad': '#485df4',
  'Adaptación': '#1bea9a',
  'Persuasión': '#9b4dca',
  'Estructura': '#ff8c42',
  'Propósito': '#ffd93d',
  'Empatía': '#ef4444',
};

const LEVEL_THRESHOLDS = [0, 500, 1500, 3500, 7000, 15000];
const RANK_NAMES = ['Novato', 'Aprendiz', 'Competente', 'Experto', 'Maestro', 'Leyenda'];

function calculateLevel(xp: number): { level: number; rank: string; nextLevelXP: number } {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) {
      return {
        level: i + 1,
        rank: RANK_NAMES[i] || 'Leyenda',
        nextLevelXP: LEVEL_THRESHOLDS[i + 1] || LEVEL_THRESHOLDS[i],
      };
    }
  }
  return { level: 1, rank: 'Novato', nextLevelXP: 500 };
}

function calculateCompletedNodes(dates: { created_at: string }[]): number {
  const now = new Date();
  const thisMonth = dates.filter(c => {
    const d = new Date(c.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const uniqueDays = new Set(
    thisMonth.map(c => new Date(c.created_at).toDateString())
  );

  return Math.min(Math.floor(uniqueDays.size / 2), 15);
}

function buildNodes(completedCount: number): MountainNode[] {
  return NODE_POSITIONS.map(([x, y], index) => {
    let status: MountainNode['status'] = 'locked';
    if (index < completedCount) status = 'completed';
    else if (index === completedCount) status = 'current';
    return { index, x, y, status };
  });
}

// Desktop CommunicationFeedback has mixed English/Spanish field names
function getDimValue(fb: CommunicationFeedback, dim: string): number | undefined {
  switch (dim) {
    case 'claridad': return (fb as Record<string, unknown>).claridad as number ?? fb.clarity;
    case 'estructura': return (fb as Record<string, unknown>).estructura as number ?? fb.structure;
    default: return (fb as Record<string, unknown>)[dim] as number | undefined;
  }
}

function formatRecentActivity(conversations: OmiConversation[]): RecentActivity[] {
  return conversations.slice(0, 5).map((conv, i) => {
    const score = conv.communication_feedback?.overall_score || 0;
    const feedback = conv.communication_feedback;
    const date = new Date(conv.created_at);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    let dateStr = date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    if (isToday) dateStr = 'Hoy';
    if (isYesterday) dateStr = 'Ayer';

    const timeStr = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    let insight = '';
    if (feedback?.feedback) {
      insight = feedback.feedback.slice(0, 80) + (feedback.feedback.length > 80 ? '...' : '');
    } else if (conv.overview) {
      insight = conv.overview.slice(0, 80) + (conv.overview.length > 80 ? '...' : '');
    } else if (feedback?.strengths && feedback.strengths.length > 0) {
      insight = `✓ ${feedback.strengths[0]}`;
    }

    let topSkill = '';
    if (feedback) {
      const skills = [
        { name: 'Claridad', value: getDimValue(feedback, 'claridad') || 0 },
        { name: 'Empatía', value: feedback.empatia || 0 },
        { name: 'Estructura', value: getDimValue(feedback, 'estructura') || 0 },
      ];
      const best = skills.reduce((max, s) => s.value > max.value ? s : max, skills[0]);
      if (best.value > 0) {
        topSkill = best.name;
      }
    }

    return {
      id: conv.id,
      title: conv.title || `Conversación ${i + 1}`,
      date: `${dateStr}, ${timeStr}`,
      duration: conv.duration_seconds ? `${Math.round(conv.duration_seconds / 60)}:${(conv.duration_seconds % 60).toString().padStart(2, '0')}` : '--:--',
      score: Math.round(score * 10),
      status: score >= 8 ? 'excellent' : score >= 6.5 ? 'good' : 'warning',
      insight,
      topSkill,
      emoji: conv.emoji || '\uD83D\uDCAC',
    };
  });
}

function getFirstDayOfMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export function useGamifiedDashboardDataV2(): GamifiedDashboardDataV2 {
  const { maityUser } = useAuth();
  const [conversations, setConversations] = useState<OmiConversation[]>([]);
  const [conversationDates, setConversationDates] = useState<{ created_at: string }[]>([]);
  const [formData, setFormData] = useState<FormResponse | null>(null);
  const [streakData, setStreakData] = useState<{ streak_days: number; bonus_days: number }>({ streak_days: 0, bonus_days: 0 });
  const [xpFromRPC, setXpFromRPC] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!maityUser?.id) {
        setLoading(false);
        return;
      }

      // Helper: race a promise against a timeout (returns null on timeout)
      const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
        Promise.race([
          promise,
          new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
        ]);

      try {
        // Primary data with 8s timeout — unblocks the dashboard quickly
        const result = await withTimeout(
          Promise.all([
            getOmiConversations(maityUser.id),
            getOmiConversationDates(maityUser.id, getFirstDayOfMonth()),
            getFormResponses(maityUser.id),
          ]),
          8000,
        );

        if (cancelled) return;

        if (result) {
          const [listData, datesData, formResponse] = result;
          setConversations(listData);
          setConversationDates(datesData);
          setFormData(formResponse);
          if (!formResponse) {
            console.warn('[Gamification] formData is null — getFormResponses() returned no data');
          }
        } else {
          console.warn('[Gamification] Primary data fetch timed out after 8s — showing defaults');
        }
      } catch (err) {
        console.error('Error loading conversations for gamified dashboard v2:', err);
      } finally {
        // Unblock dashboard immediately — streak/XP load in background
        if (!cancelled) setLoading(false);
      }

      // Secondary data (streak + XP) — non-blocking, loaded after dashboard renders
      try {
        const [streakResult, xpResult] = await Promise.all([
          withTimeout(Promise.resolve(supabase.rpc('calculate_user_streak', { p_user_id: maityUser.id })), 8000),
          withTimeout(Promise.resolve(supabase.rpc('get_my_xp_summary')), 8000),
        ]);

        if (cancelled) return;

        if (streakResult?.data && Array.isArray(streakResult.data) && streakResult.data.length > 0) {
          setStreakData(streakResult.data[0]);
        } else if (streakResult?.error) {
          console.warn('[Gamification] streak RPC error:', streakResult.error.message);
        }

        if (xpResult?.data && typeof xpResult.data === 'object' && 'total_xp' in xpResult.data) {
          setXpFromRPC((xpResult.data as { total_xp: number }).total_xp);
        } else if (xpResult?.error) {
          console.warn('[Gamification] XP RPC error:', xpResult.error.message);
        }
      } catch (err) {
        console.warn('[Gamification] Streak/XP fetch failed (non-fatal):', err);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [maityUser?.id]);

  const completedNodes = useMemo(
    () => calculateCompletedNodes(conversationDates),
    [conversationDates]
  );

  const nodes = useMemo(() => buildNodes(completedNodes), [completedNodes]);

  // Build 6 competencies from form_responses (self-assessment), fallback to conversation data
  const competencies = useMemo((): Competency[] => {
    const defaultCompetencies = Object.entries(COMPETENCY_COLORS).map(([name, color]) => ({
      name, value: 0, color,
    }));

    if (formData) {
      const qVal = (q?: string) => q ? parseInt(q) * 20 : 0;
      const dimValues: Record<string, number> = {
        'Claridad':    Math.round((qVal(formData.q5) + qVal(formData.q6)) / 2),
        'Adaptación':  Math.round((qVal(formData.q7) + qVal(formData.q8)) / 2),
        'Persuasión':  Math.round((qVal(formData.q9) + qVal(formData.q10)) / 2),
        'Estructura':  Math.round((qVal(formData.q11) + qVal(formData.q12)) / 2),
        'Propósito':   Math.round((qVal(formData.q13) + qVal(formData.q14)) / 2),
        'Empatía':     Math.round((qVal(formData.q15) + qVal(formData.q16)) / 2),
      };
      return defaultCompetencies.map(comp => ({
        ...comp,
        value: dimValues[comp.name] || 0,
      }));
    }

    // Fallback: use latest conversation's communication_feedback
    const latest = conversations.find(c => c.communication_feedback?.overall_score != null);
    if (!latest?.communication_feedback) return defaultCompetencies;
    const fb = latest.communication_feedback;
    const dimValues: Record<string, number> = {
      'Claridad':    Math.round((getDimValue(fb, 'claridad') ?? 0) * 10),
      'Adaptación':  Math.round((fb.adaptacion ?? 0) * 10),
      'Persuasión':  Math.round((fb.vocabulario ?? 0) * 10),
      'Estructura':  Math.round((getDimValue(fb, 'estructura') ?? 0) * 10),
      'Propósito':   Math.round((fb.objetivo ?? 0) * 10),
      'Empatía':     Math.round((fb.empatia ?? 0) * 10),
    };
    return defaultCompetencies.map(comp => ({
      ...comp,
      value: dimValues[comp.name] || 0,
    }));
  }, [formData, conversations]);

  // Streak and bonus days from Supabase RPC (matches web app logic: weekends don't break streak)
  const streakDays = streakData.streak_days;
  const bonusDays = streakData.bonus_days;

  // Score from last 2 conversations
  const score = useMemo(() => {
    const scored = conversations.filter(c => c.communication_feedback?.overall_score);
    if (scored.length >= 2) {
      return {
        today: scored[0].communication_feedback!.overall_score!,
        yesterday: scored[1].communication_feedback!.overall_score!,
      };
    }
    if (scored.length === 1) {
      return { today: scored[0].communication_feedback!.overall_score!, yesterday: 0 };
    }
    return { yesterday: 0, today: 0 };
  }, [conversations]);

  // XP from Supabase RPC (includes all sources: conversations, games, badges, etc.)
  const totalXP = xpFromRPC;

  const { level, rank, nextLevelXP } = useMemo(() => calculateLevel(totalXP), [totalXP]);

  // Ranking: show current user only (no leaderboard RPC on desktop)
  const ranking = useMemo((): RankingEntry[] => {
    return [{
      position: 1,
      name: maityUser?.first_name || 'Tú',
      xp: totalXP,
      streak: streakDays,
      isCurrentUser: true,
    }];
  }, [maityUser?.first_name, totalXP, streakDays]);

  // Badges based on XP
  const badges = useMemo((): Badge[] => {
    return BADGE_DEFINITIONS.map(badge => ({
      ...badge,
      unlocked: totalXP >= badge.xp,
    }));
  }, [totalXP]);

  // Recent activity
  const recentActivity = useMemo(() => formatRecentActivity(conversations), [conversations]);

  // Analytics from latest conversation
  const analytics = useMemo(() => {
    const latest = conversations.find(c => c.communication_feedback?.radiografia);
    const muletillasRate = latest?.communication_feedback?.radiografia?.muletillas_total ?? 0;
    const ratioHabla = latest?.communication_feedback?.radiografia?.ratio_habla ?? 0;
    const muletillasScore = Math.round(Math.max(0, 100 - muletillasRate));
    const flowScore = Math.round(Math.min(100, ratioHabla * 20));
    return {
      muletillasScore,
      flowScore,
      muletillas: muletillasScore,
      flow: flowScore,
    };
  }, [conversations]);

  // Mission progress based on completed nodes
  const mission = useMemo((): Mission => ({
    ...MOCK_MISSION,
    progress: Math.round((completedNodes / 15) * 100),
  }), [completedNodes]);

  return {
    userName: maityUser?.first_name || 'Usuario',
    userRole: 'Comunicador',
    level,
    rank,
    totalXP,
    xp: totalXP,
    nextLevelXP,
    streakDays,
    streak: streakDays,
    bonusDays,
    score,
    nodes,
    completedNodes,
    competencies,
    mission: { ...mission, map: mission.name },
    badges,
    analytics,
    ranking,
    recentActivity,
    conversations,
    formData,
    loading,
  };
}
