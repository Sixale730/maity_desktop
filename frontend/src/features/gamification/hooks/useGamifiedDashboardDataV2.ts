import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { fileLogger } from '@/lib/fileLogger';
import {
  getOmiConversations,
  getFormResponses,
  OmiConversation,
  CommunicationFeedback,
  FormResponse,
} from '@/features/conversations/services/conversations.service';
import { getCommScore } from '@/features/conversations/utils/scoring';

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
  scoreSparkline: Array<{ v: number }>;
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
  { id: '1', name: 'Negociador Valiente', xp: 50, icon: '🛡️', color: '#3b82f6' },
  { id: '2', name: 'Precisión Verbal', xp: 90, icon: '🎯', color: '#ef4444' },
  { id: '3', name: 'Empático', xp: 50, icon: '❤️', color: '#10b981' },
  { id: '4', name: 'Astucia Disruptiva', xp: 170, icon: '🧠', color: '#9333ea' },
  { id: '5', name: 'Orador Maestro', xp: 500, icon: '🎤', color: '#f59e0b' },
  { id: '6', name: 'Líder Nato', xp: 1000, icon: '👑', color: '#ec4899' },
];

const MOCK_MISSION: Mission = {
  name: 'Montaña de Fuego',
  enemy: 'EL REGATEADOR',
  enemyDesc: 'Escéptico, Ocupado, Orientado a datos',
  enemyIcon: '👹',
  items: [
    { name: 'Pico de Piedra', icon: '⛏️' },
    { name: 'Casco de Lava', icon: '⛑️' },
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
      emoji: conv.emoji || '💬',
    };
  });
}

interface StreakRPCResult { streak_days: number; bonus_days: number }

export function useGamifiedDashboardDataV2(): GamifiedDashboardDataV2 {
  const { maityUser } = useAuth();
  const userId = maityUser?.id;

  // Conversations: shared queryKey with the rest of the app. GlobalConversationNotifier
  // (root layout) invalidates this on Supabase Realtime UPDATE, so the dashboard refetches
  // automatically when an analysis lands without the user having to navigate away.
  const conversationsQuery = useQuery({
    queryKey: ['omi-conversations', userId],
    queryFn: async () => {
      const t0 = Date.now();
      void fileLogger.info('dashboard_query', 'omi-conversations start', { userIdSuffix: userId?.slice(-8) });
      try {
        const result = await getOmiConversations(userId);
        void fileLogger.info('dashboard_query', 'omi-conversations ok', {
          rows: result.length,
          durationMs: Date.now() - t0,
        });
        return result;
      } catch (err) {
        void fileLogger.error('dashboard_query', 'omi-conversations fail', {
          message: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - t0,
        });
        throw err;
      }
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);

  // Form responses: separate table (form_responses), realtime not wired. Shared key with
  // useFormResponsesRadar so both consumers hit the same cache entry.
  const formQuery = useQuery({
    queryKey: ['form-responses', userId],
    queryFn: async () => {
      const t0 = Date.now();
      void fileLogger.info('dashboard_query', 'form-responses start', { userIdSuffix: userId?.slice(-8) });
      try {
        const result = await getFormResponses(userId!);
        void fileLogger.info('dashboard_query', 'form-responses ok', {
          hasData: !!result,
          durationMs: Date.now() - t0,
        });
        return result;
      } catch (err) {
        void fileLogger.error('dashboard_query', 'form-responses fail', {
          message: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - t0,
        });
        throw err;
      }
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
  const formData = formQuery.data ?? null;

  const streakQuery = useQuery<StreakRPCResult>({
    queryKey: ['user-streak', userId],
    queryFn: async () => {
      const t0 = Date.now();
      void fileLogger.info('dashboard_query', 'user-streak start', { userIdSuffix: userId?.slice(-8) });
      const { data, error } = await supabase.rpc('calculate_user_streak', { p_user_id: userId });
      if (error) {
        console.warn('[Gamification] streak RPC error:', error.message);
        void fileLogger.warn('dashboard_query', 'user-streak rpc-error', {
          message: error.message,
          durationMs: Date.now() - t0,
        });
        return { streak_days: 0, bonus_days: 0 };
      }
      const result = Array.isArray(data) && data.length > 0 ? (data[0] as StreakRPCResult) : { streak_days: 0, bonus_days: 0 };
      void fileLogger.info('dashboard_query', 'user-streak ok', {
        streak_days: result.streak_days,
        durationMs: Date.now() - t0,
      });
      return result;
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
  const streakData = streakQuery.data ?? { streak_days: 0, bonus_days: 0 };

  const xpQuery = useQuery<number>({
    queryKey: ['user-xp', userId],
    queryFn: async () => {
      const t0 = Date.now();
      void fileLogger.info('dashboard_query', 'user-xp start', { userIdSuffix: userId?.slice(-8) });
      const { data, error } = await supabase.rpc('get_my_xp_summary');
      if (error) {
        console.warn('[Gamification] XP RPC error:', error.message);
        void fileLogger.warn('dashboard_query', 'user-xp rpc-error', {
          message: error.message,
          durationMs: Date.now() - t0,
        });
        return 0;
      }
      if (data && typeof data === 'object' && 'total_xp' in data) {
        const total = (data as { total_xp: number }).total_xp;
        void fileLogger.info('dashboard_query', 'user-xp ok', {
          total_xp: total,
          durationMs: Date.now() - t0,
        });
        return total;
      }
      void fileLogger.info('dashboard_query', 'user-xp ok', { total_xp: 0, durationMs: Date.now() - t0 });
      return 0;
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
  const totalXP = xpQuery.data ?? 0;

  // Conversation dates for mountain nodes — derived from the canonical conversations cache
  // so realtime invalidations propagate without an extra fetch.
  const conversationDates = useMemo(() => {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    return conversations
      .filter(c => new Date(c.created_at) >= startOfMonth)
      .map(c => ({ created_at: c.created_at }));
  }, [conversations]);

  // Recent scores for the sparkline — derived from `conversations` to stay reactive.
  // Mirrors the original getRecentConversationScores: V4 puntaje preferred over legacy×10,
  // filter score > 0, max 6 most recent (conversations are pre-sorted DESC by created_at).
  const recentScores = useMemo(() => {
    return conversations
      .map(c => ({ created_at: c.created_at, score: getCommScore(c) ?? 0 }))
      .filter(r => r.score > 0)
      .slice(0, 6);
  }, [conversations]);

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

  const streakDays = streakData.streak_days;
  const bonusDays = streakData.bonus_days;

  // Sparkline data: chronological left→right (recentScores is DESC, so reverse).
  const scoreSparkline = useMemo(
    () => [...recentScores].reverse().map((s) => ({ v: Math.round(s.score) })),
    [recentScores],
  );

  // Score from last 2 conversations (legacy field — kept for backwards compat with consumers)
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

  const { level, rank, nextLevelXP } = useMemo(() => calculateLevel(totalXP), [totalXP]);

  const ranking = useMemo((): RankingEntry[] => {
    return [{
      position: 1,
      name: maityUser?.first_name || 'Tú',
      xp: totalXP,
      streak: streakDays,
      isCurrentUser: true,
    }];
  }, [maityUser?.first_name, totalXP, streakDays]);

  const badges = useMemo((): Badge[] => {
    return BADGE_DEFINITIONS.map(badge => ({
      ...badge,
      unlocked: totalXP >= badge.xp,
    }));
  }, [totalXP]);

  const recentActivity = useMemo(() => formatRecentActivity(conversations), [conversations]);

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

  const mission = useMemo((): Mission => ({
    ...MOCK_MISSION,
    progress: Math.round((completedNodes / 15) * 100),
  }), [completedNodes]);

  const loading = conversationsQuery.isLoading || formQuery.isLoading;

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
    scoreSparkline,
    loading,
  };
}
