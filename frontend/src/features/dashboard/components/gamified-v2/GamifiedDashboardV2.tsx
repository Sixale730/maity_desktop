'use client';
// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/GamifiedDashboardV2.tsx
// ADAPTADO (no es copia tal cual) — diferencias con la web, todas por reglas del desktop:
//  - Datos: `useUser()` del shim `@/contexts/UserContext` (userProfile.id = maityUser.id, nunca
//    auth user.id); autoevaluación con `useFormResponsesRadar` (en vez de `useFormResponses` de
//    @maity/shared); sin `useAvatarWithDefault`: el retrato es 2D (`DashboardPortrait`, iniciales)
//    y no se consulta la tabla de avatares.
//  - Bundle (#24): nada de recharts/three/framer estático. Radar = `RadarChartV2` (SVG propio,
//    recoloreado con `--radar-*` de radar-palette.css); Evolución = `LazyCommunicationTrendChart`;
//    Muletillas = `LazyProgressChartsSection` (dynamic, ssr:false; el chunk baja al abrir la pestaña).
//    Momentos y Contexto también van diferidos (`LazyDashboardPanels`) por el presupuesto de arranque.
//  - Evolución conserva los estados vacíos A–D del dashboard anterior; "Empezar a grabar" /
//    "Grabar otra" usan el PUENTE del Sidebar (`start-recording-from-sidebar` en la home, o
//    `autoStartRecording` + push('/') desde otra ruta) — NUNCA `router.push('/')` a secas.
//  - Momentos y el resumen de Contexto solo reciben conversaciones con `isFullAnalysis(v4)` (#72:
//    el marcador de análisis omitido es truthy y la web lo trataría como analizado).
//  - Sin links a /avatar ni /expedicion (el explorador y el atlas están fuera de alcance): se
//    quitaron el link del retrato, "Mapas y logros / Mi personaje" y la guía de habilidades.
//  - Layout: SIN breakpoints md:/lg: (DPI de Windows, docs/UI_REGLAS.md); el CSS portado usa
//    `@container dashboard` y este root declara el contenedor (dashboard-desktop.css). `pb-28`
//    deja libre la píldora de grabación.
import { useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Award, Crown, Sparkles, Target, TrendingUp } from 'lucide-react';
import type { AvatarConfiguration } from '@maity/shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Spinner } from '@/components/ui/spinner';
import { Card } from '@/components/ui/card';
import { useUser } from '@/contexts/UserContext';
import { isFullAnalysis } from '@/features/conversations/services/conversations.service';
import { useFormResponsesRadar } from '@/features/gamification/hooks/useFormResponsesRadar';
import { RadarChartV2, type RadarSeriesPoint } from '@/features/gamification/components/RadarChartV2';
// recharts NO se importa aquí: entra al home en el arranque (#24). Ambas gráficas van diferidas.
import { LazyCommunicationTrendChart } from '@/features/gamification/components/LazyCommunicationTrendChart';
import { DashboardPortrait } from '@/features/dashboard/adapters/DashboardPortrait';
import { useGamifiedDashboardDataV2 } from '../../hooks/useGamifiedDashboardDataV2';
import { useProgressChartsData } from '../../hooks/useProgressChartsData';
import { LazyConversationMoments as ConversationMoments, LazyPerformanceSummary as PerformanceSummary } from './LazyDashboardPanels';
import { ExpeditionPilot } from './ExpeditionPilot';
import { LazyProgressChartsSection } from './LazyProgressChartsSection';
import { GENERIC_TIPS } from './dashboard-tips';
import { ProgressBar, PillStat } from './DashboardStats';
import './dashboard-fit.css';
import './dashboard-unified.css';
import './dashboard-desktop.css';

// Maps competency name (Tu Radar) → radar dim key (IA data)
const COMPETENCY_TO_DIM: Record<string, string> = {
  'Claridad': 'Claridad',
  'Estructura': 'Estructura',
  'Empatía': 'Empatía',
  'Adaptación': 'Adaptación',
  'Persuasión': 'Vocabulario',
  'Propósito': 'Objetivo',
};

/** Sin avatar guardado en el desktop: el retrato es 2D y `ExpeditionReward` no pinta equipo puesto. */
const NO_AVATAR: Partial<AvatarConfiguration> = Object.freeze({});

export function GamifiedDashboardV2() {
  const router = useRouter();
  const pathname = usePathname();
  const { userProfile } = useUser();
  const data = useGamifiedDashboardDataV2();
  const { radarData, sessionHistory, fillerWordsInsight } = useProgressChartsData(data.conversations);
  const { radarData: selfAssessmentData } = useFormResponsesRadar();

  const firstName = userProfile?.first_name || 'Usuario';

  // Arranca la grabación reutilizando el puente del Sidebar (docs/UI_REGLAS.md): en la home
  // despacha el evento directo (lo escucha useRecordingStart); desde otra ruta deja el flag
  // autoStartRecording y navega a la home, que lo consume al montar.
  const handleStartRecording = () => {
    if (pathname === '/') {
      window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
    } else {
      sessionStorage.setItem('autoStartRecording', 'true');
      router.push('/');
    }
  };

  // Momentos/Contexto: solo análisis V4 completos (#72). El marcador `AnalysisSkipped` es truthy.
  const analyzedConversations = useMemo(
    () => data.conversations.filter((c) => isFullAnalysis(c.communication_feedback_v4)),
    [data.conversations],
  );

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
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  // Find strongest and weakest competency (based on autoevaluation, as before)
  const strongest = data.competencies.length > 0
    ? data.competencies.reduce((max, c) => c.value > max.value ? c : max, data.competencies[0])
    : { name: '—', value: 0 };
  const weakest = data.competencies.length > 0
    ? data.competencies.reduce((min, c) => c.value < min.value ? c : min, data.competencies[0])
    : { name: '—', value: 0 };

  // Calculate XP progress percentage
  const xpProgress = data.nextLevelXP > 0 ? Math.min((data.xp / data.nextLevelXP) * 100, 100) : 0;

  return (
    <div className="maity-home-dashboard flex-1 min-h-0 flex flex-col">
      <div className="dashboard-page-header flex-shrink-0 flex items-center gap-4 border-b border-border bg-background">
        <div className="min-w-0 flex-1">
          <h1 className="font-geist text-[22px] font-semibold text-foreground truncate tracking-[-0.5px] leading-[1.1]">
            {`Hola, ${firstName} 👋`}
          </h1>
          <div className="text-[12.5px] text-foreground/40 mt-0.5 truncate">
            Cada práctica cuenta en tu próximo ascenso.
          </div>
        </div>
        <div className="dashboard-header-actions flex items-center gap-2">
          <PillStat icon="🔥" value={data.streak} label="Días racha" color="hsl(var(--maity-pink))" />
        </div>
      </div>
      <div className="dashboard-page-content dashboard-fit-content flex-1 min-h-0 overflow-y-auto">
        <div className="dashboard-fit-layout max-w-[1500px] mx-auto pb-28">

          {/* Avatar row — visual anchor above the expedition; greeting + pills live in the header. */}
          <div className="dashboard-fit-profile flex items-center gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-maity-blue p-1 shadow-lg shadow-pink-500/20">
                <div className="w-full h-full rounded-full bg-surface-elevated overflow-hidden flex items-center justify-center">
                  <DashboardPortrait config={NO_AVATAR} size="md" />
                </div>
              </div>
              <div className="absolute -bottom-1 -right-1 bg-maity-blue text-white text-xs font-bold px-2 py-0.5 rounded-full border-2 border-background">
                Lv.{data.level}
              </div>
            </div>
            <div className="flex-1 min-w-0 max-w-md">
              <div className="text-sm text-foreground/70 mb-1.5">
                <span className="text-accent font-semibold">{data.rank}</span> · {data.xp} / {data.nextLevelXP} XP
              </div>
              <ProgressBar value={xpProgress} color="hsl(var(--primary))" height="h-1.5" glow />
            </div>
          </div>
          <div className="dashboard-unified">
            <ExpeditionPilot userId={userProfile?.id} avatar={NO_AVATAR} xp={data.xp} />
            <aside className="dashboard-unified-metrics" aria-label="Tu desempeño">
              <div className="dashboard-visible-charts">
                <section aria-label="Radar de habilidades">
                  <Card className="p-4 bg-card border border-border hover:border-blue-500/30 transition-colors">
                    <div className="flex justify-between items-center mb-2">
                      <h3 className="font-bold text-foreground flex items-center gap-2">
                        <Target size={16} className="text-blue-700 dark:text-blue-400" /> Tu Radar: IA vs Autoevaluación
                      </h3>
                    </div>
                    <div className="flex justify-center -mx-2">
                      <RadarChartV2 data={enrichedRadarData} size={200} />
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">IA: promedio de seis habilidades. Autoevaluación: tu percepción.</p>
                    <div className="pt-2 border-t border-border grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-green-500/10 rounded-lg p-2 text-center">
                        <span className="text-muted-foreground block mb-1">💪 Fortaleza percibida</span>
                        <span className="text-green-700 dark:text-green-400 font-bold">{strongest.name}</span>
                      </div>
                      <div className="bg-pink-500/10 rounded-lg p-2 text-center">
                        <span className="text-muted-foreground block mb-1">🎯 Prioridad percibida</span>
                        <span className="text-pink-700 dark:text-pink-400 font-bold">{weakest.name}</span>
                      </div>
                    </div>
                  </Card>
                </section>
                <Tabs defaultValue="moments" className="dashboard-explore-charts">
                  <TabsList className="grid grid-cols-4 w-full">
                    <TabsTrigger value="moments">Momentos</TabsTrigger>
                    <TabsTrigger value="evolution">Evolución</TabsTrigger>
                    <TabsTrigger value="fillers">Muletillas</TabsTrigger>
                    <TabsTrigger value="context">Contexto</TabsTrigger>
                  </TabsList>
                  <TabsContent value="moments">
                    <ConversationMoments conversations={analyzedConversations} />
                  </TabsContent>
                  <TabsContent value="evolution" aria-label="Evolución de comunicación">
                    {/* 4 estados según conversaciones analizadas (dashboard anterior del desktop):
                        A) sin grabaciones → invitar a grabar · B) grabadas sin análisis → pendiente
                        C) 1 analizada → primer puntaje + grabar otra · D) 2+ → gráfica de tendencia */}
                    {data.conversations.length === 0 ? (
                      <Card className="bg-card border border-border">
                        <div className="dashboard-evolution-empty">
                          <Sparkles size={26} className="text-primary" aria-hidden="true" />
                          <h3>Empieza tu primera conversación</h3>
                          <p>Tu progreso de comunicación aparecerá aquí cuando analices tu primera grabación.</p>
                          <button type="button" onClick={handleStartRecording} className="dashboard-record-button">
                            <Sparkles size={16} aria-hidden="true" /> Empezar a grabar
                          </button>
                        </div>
                      </Card>
                    ) : communicationTrend.length === 0 ? (
                      <Card className="bg-card border border-border">
                        <div className="dashboard-evolution-empty">
                          <Award size={26} className="text-muted-foreground" aria-hidden="true" />
                          <h3>Tu primera puntuación aparecerá aquí</h3>
                          <p>Cuando termine el análisis de tu conversación verás tu puntaje, y con una segunda grabación se desbloquea tu gráfica de tendencia.</p>
                        </div>
                      </Card>
                    ) : communicationTrend.length === 1 ? (
                      <Card className="bg-card border border-border">
                        <div className="dashboard-evolution-empty">
                          <span className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-1.5">
                            <Award size={14} aria-hidden="true" /> Tu primera puntuación
                          </span>
                          <span className="dashboard-first-score">{communicationTrend[0].score}</span>
                          <span className="text-xs text-muted-foreground">de 100</span>
                          <div className="dashboard-milestone">
                            <div className="flex justify-between text-xs mb-1.5">
                              <span className="text-muted-foreground">Gráfica de tendencia</span>
                              <span className="text-primary font-bold">1 / 2</span>
                            </div>
                            <div className="dashboard-milestone-track"><span /></div>
                          </div>
                          <p>Graba 1 conversación más para desbloquear tu gráfica de tendencia.</p>
                          <button type="button" onClick={handleStartRecording} className="dashboard-record-button">
                            <Sparkles size={16} aria-hidden="true" /> Grabar otra
                          </button>
                        </div>
                      </Card>
                    ) : (
                      <Card className="p-5 bg-card border border-border flex flex-col">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="font-bold text-foreground flex items-center gap-2">
                              <TrendingUp size={18} className="text-pink-700 dark:text-pink-500" />
                              Cómo va tu Comunicación
                            </h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Calificación de tus últimas conversaciones
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {communicationTrend.length} más recientes
                          </span>
                        </div>
                        <div className="flex-1 min-h-[240px]">
                          <LazyCommunicationTrendChart data={communicationTrend} />
                        </div>
                      </Card>
                    )}
                  </TabsContent>
                  <TabsContent value="fillers" aria-label="Evolución de muletillas">
                    <LazyProgressChartsSection conversations={data.conversations} />
                  </TabsContent>
                  <TabsContent value="context">
                    {fillerWordsInsight && <p className="text-xs text-muted-foreground mb-2">Muletillas: {fillerWordsInsight}</p>}
                    <p className="text-xs text-muted-foreground mb-2">El XP muestra tu avance de nivel. Las evaluaciones muestran cómo te comunicas.</p>
                    <PerformanceSummary radar={radarData} sessions={sessionHistory} conversations={analyzedConversations} />
                    <details className="dashboard-unified-ranking">
                      <summary>Ranking del equipo</summary>
                      <div className="dashboard-fit-ranking">
                        <Card className="p-5 bg-card border border-border">
                          <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                            <Crown size={18} className="text-yellow-700 dark:text-yellow-500" /> Ranking · XP acumulado
                          </h3>
                          <div className="space-y-2">
                            {data.ranking.map((entry, i) => (
                              <div
                                key={i}
                                className={`flex items-center justify-between p-2.5 rounded-xl transition-all ${
                                  entry.isCurrentUser
                                    ? 'bg-secondary border border-border'
                                    : 'bg-muted hover:bg-secondary'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-muted text-muted-foreground">
                                    {entry.position <= 3 ? (
                                      entry.position === 1 ? '🥇' : entry.position === 2 ? '🥈' : '🥉'
                                    ) : entry.position}
                                  </div>
                                  {entry.isCurrentUser && <div className="w-9 h-9 shrink-0"><DashboardPortrait config={NO_AVATAR} size="sm" /></div>}
                                  <span className={`font-medium text-sm ${entry.isCurrentUser ? 'text-foreground' : 'text-muted-foreground'}`}>
                                    {entry.name}
                                  </span>
                                </div>
                                <span className="text-xs text-muted-foreground font-mono">
                                  {entry.xp >= 1000 ? `${(entry.xp / 1000).toFixed(1)}K` : entry.xp} XP
                                </span>
                              </div>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground mt-3">Participación acumulada; no mide dominio. Ranking semanal y personajes de compañeros pendientes de conexión.</p>
                        </Card>
                      </div>
                    </details>
                    <details className="dashboard-unified-tips">
                      <summary>Consejos para mejorar</summary>
                      <div className="dashboard-fit-tips">
                        <div className="mb-6">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="h-px flex-1 bg-border" />
                            <span className="text-2xs font-bold uppercase tracking-[3px] text-muted-foreground">
                              Tips de Comunicación
                            </span>
                            <div className="h-px flex-1 bg-border" />
                          </div>
                          {/* Sin md:/lg: (DPI): la columna de métricas ya fuerza 1 columna (dashboard-unified.css). */}
                          <div className="grid grid-cols-1 gap-4">
                            {GENERIC_TIPS.map((tip) => (
                              <Card
                                key={tip.num}
                                className="p-4 bg-card border border-border border-t-4 flex flex-col gap-2"
                                style={{ borderTopColor: `color-mix(in srgb, ${tip.accent} 35%, transparent)` }}
                              >
                                <div
                                  className="w-9 h-9 rounded-xl flex items-center justify-center text-base font-extrabold"
                                  style={{ backgroundColor: `color-mix(in srgb, ${tip.accent} 8%, transparent)`, color: tip.accent }}
                                >
                                  {tip.num}
                                </div>
                                <h4 className="text-sm font-bold text-foreground">{tip.title}</h4>
                                <p className="text-xs text-muted-foreground leading-relaxed flex-1">{tip.desc}</p>
                                <p className="text-2xs text-muted-foreground uppercase tracking-wider">{tip.meta}</p>
                              </Card>
                            ))}
                          </div>
                        </div>
                      </div>
                    </details>
                  </TabsContent>
                </Tabs>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GamifiedDashboardV2;
