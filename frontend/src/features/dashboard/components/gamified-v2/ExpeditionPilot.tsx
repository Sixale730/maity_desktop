'use client';
/* eslint-disable @next/next/no-img-element -- export estático (images.unoptimized): next/image no optimiza nada aquí; copia web tal cual */
// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/ExpeditionPilot.tsx
// Adaptaciones desktop: 'use client'; react-router-dom → @/lib/router-compat (mapa web→desktop y externos a maity.cloud); VoxelAvatar (three.js) → retrato 2D DashboardPortrait (sin three en el arranque).
import { useState, useEffect, type ReactNode } from 'react';
import { Link } from '@/lib/router-compat';
import { Check, LockKeyhole, ArrowRight, Compass, Clock3, Route, Sparkles } from 'lucide-react';
import { useLearningPath, gearAsset, COSMETIC_REWARDS, type AvatarConfiguration } from '@maity/shared';
import { DashboardPortrait as VoxelAvatar } from '@/features/dashboard/adapters/DashboardPortrait';
import { activeExplorer } from '@/features/avatar/components/explorer-design';
import { expeditionWindow, SAMPLE_STOPS, STOP_LABELS, EXPEDITION_POSITIONS as POSITIONS, expeditionTrail, conqueredTrail } from './expedition-model';
import './expedition-pilot.css';
import '@/features/expedition/expedition-visual-system.css';
import { LavaBoss } from '@/features/expedition/LavaBoss';
import { ExpeditionReward } from './ExpeditionReward';
import { ExpeditionIcon } from '@/features/expedition/ExpeditionIcon';


const statusMap = (nodes: { nodeId: string; status: string }[]) => new Map(nodes.map(n => [n.nodeId, n.status] as [string, string]));

export function ExpeditionPilot({ userId, avatar, xp, children }: { userId?: string; avatar: Partial<AvatarConfiguration>; xp?: number; children?: ReactNode }) {
  const [fireMotion, setFireMotion] = useState(true);
  const path = useLearningPath(userId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState(false);
  const live = !path.isLoading && !path.error && !!path.data?.nodes.length;
  const window = expeditionWindow(live ? path.data!.nodes : []);
  const stops = live ? window.stops : SAMPLE_STOPS;
  const currentId = live ? window.currentId : SAMPLE_STOPS[1].nodeId;
  const selected = stops.find(n => n.nodeId === selectedId) ?? stops.find(n => n.nodeId === currentId) ?? stops[0];
  const currentIndex = stops.findIndex(n => n.nodeId === currentId);
  const completed = stops.filter(n => n.status === 'completed').length;
  const selectedIndex = stops.findIndex(n => n.nodeId === selected.nodeId);
  const stage = selectedIndex < 2 ? 0 : selectedIndex < 5 ? 1 : selectedIndex < 7 ? 2 : 3;
  const stages = ['Explora', 'Entrena', 'Practica', 'Conquista'];
  const summitReward = COSMETIC_REWARDS.find(reward => reward.id === 'medal')!;
  const [celebration, setCelebration] = useState<{ title: string; reward: boolean } | null>(null);
  const orderedNodes = live ? [...path.data!.nodes].sort((a, b) => a.orderIndex - b.orderIndex || a.nodeId.localeCompare(b.nodeId)) : [];
  const firstBoss = orderedNodes.find(n => n.nodeType === 'checkpoint');
  const bossIndex = orderedNodes.findIndex(n => n.nodeId === firstBoss?.nodeId);
  const activeIndex = orderedNodes.findIndex(n => n.nodeId === currentId);
  const nearBoss = live && firstBoss?.status !== 'completed' && activeIndex >= 0 && bossIndex >= activeIndex && bossIndex - activeIndex <= 1;
  const [seen, setSeen] = useState<{ live: boolean; data: unknown; userId?: string; bossId?: string; statuses: Map<string, string> | null }>(() => ({ live, data: path.data, userId, bossId: firstBoss?.nodeId, statuses: live ? statusMap(path.data!.nodes) : null }));

  if (seen.live !== live || seen.data !== path.data || seen.userId !== userId || seen.bossId !== firstBoss?.nodeId) {
    const before = live && seen.statuses && seen.userId === userId ? seen.statuses : null;
    const newlyCompleted = before && path.data!.nodes.find(n => n.status === 'completed' && before.has(n.nodeId) && before.get(n.nodeId) !== 'completed');
    if (newlyCompleted) setCelebration({ title: newlyCompleted.title, reward: newlyCompleted.nodeId === firstBoss?.nodeId });
    else if (!before) setCelebration(null);
    setSeen({ live, data: path.data, userId, bossId: firstBoss?.nodeId, statuses: live ? statusMap(path.data!.nodes) : null });
  }

  useEffect(() => {
    if (!celebration) return;
    const timeout = globalThis.setTimeout(() => setCelebration(null), 5000);
    return () => globalThis.clearTimeout(timeout);
  }, [celebration]);

  return <section className="expedition-pilot" data-motion={fireMotion ? 'active' : 'paused'} aria-label="Tu expedición">
    <div className="expedition-heading">
      <div><p className="expedition-eyebrow">TU EXPEDICIÓN · PILOTO VISUAL</p><h2>{live ? 'Tu próximo ascenso' : 'Montaña de Fuego'}</h2></div>
      <button className="lava-motion-toggle" aria-pressed={fireMotion} onClick={() => setFireMotion(v => !v)}>{fireMotion ? "Pausar animaciones" : "Activar animaciones"}</button>
      {live && <span className="expedition-badge">{completed}/{stops.length} hitos de este tramo</span>}
    </div>
    <p className="expedition-status" role="status">{live ? `Mostrando hitos ${window.start + 1}–${window.start + stops.length} de ${window.total}. Tu progreso viene de tu ruta.` : path.isLoading ? 'Consultando tu ruta. Mientras tanto, explora este ejemplo; no representa tus avances.' : path.error ? 'Tu ruta no está disponible. Este ejemplo no representa tus avances ni entrega premios.' : 'Aún no hay una ruta asignada. Explora este ejemplo sin modificar tus avances.'}
      {!!path.error && <button onClick={() => void path.refetch()} disabled={path.isFetching}>{path.isFetching ? 'Consultando…' : 'Reintentar'}</button>}
    </p>
    {!live && <p className="expedition-month">Meta: una montaña al mes <span>· Avanzas al completar los retos, a tu ritmo.</span></p>}
    <div className="expedition-body">
      <div className="expedition-map" aria-label={live ? 'Mapa de tu tramo actual' : 'Mapa de ejemplo interactivo'}>
        {celebration && <div className="expedition-celebration" role="status"><Check size={20}/><div><strong>¡Hito completado!</strong><p>{celebration.title}</p>{currentId && <small>Siguiente: {stops.find(n => n.nodeId === currentId)?.title}</small>}{celebration.reward && <small>{summitReward.name} disponible en tu equipo.</small>}</div></div>}
        <svg className="expedition-trail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path className="expedition-trail-shadow" d={expeditionTrail(POSITIONS.slice(0, stops.length))}/><path className="expedition-trail-road" d={expeditionTrail(POSITIONS.slice(0, stops.length))}/>{conqueredTrail(stops, currentId).map((segment, index) => <path key={index} className="expedition-trail-conquered" d={segment}/>)}<path className="expedition-trail-steps" d={expeditionTrail(POSITIONS.slice(0, stops.length))}/></svg>
        <div className="expedition-map-caption"><Compass size={16}/>{live ? 'Tu ruta de aprendizaje' : 'Persuasión · ejemplo de ascenso'}</div>
        {stops.map((stop, i) => <button key={stop.nodeId} data-kind={stop.nodeType} className={`expedition-stop is-${stop.status} ${currentId === stop.nodeId ? 'is-current' : ''} ${selected.nodeId === stop.nodeId ? 'is-selected' : ''}`} style={{ left: `${POSITIONS[i][0]}%`, top: `${POSITIONS[i][1]}%` }} aria-label={`${i + window.start + 1}. ${stop.title}. ${STOP_LABELS[stop.status]}${live ? '' : '. Ejemplo'}`} aria-pressed={selected.nodeId === stop.nodeId} onClick={() => setSelectedId(stop.nodeId)}>
          {stop.status === 'completed' ? <ExpeditionIcon kind="achievements"/> : stop.nodeType === 'checkpoint' ? <ExpeditionIcon kind="flag"/> : stop.nodeType === 'resource' ? <ExpeditionIcon kind="camp"/> : stop.nodeType === 'quiz' ? <ExpeditionIcon kind="target"/> : <ExpeditionIcon kind="chat"/>}
          {stop.status === 'locked' && <span className="expedition-node-lock" aria-hidden="true"><LockKeyhole size={10}/></span>}
          {currentId === stop.nodeId && <span className="expedition-stop-label">{live ? 'Estás aquí' : 'Ejemplo'}</span>}
        </button>)}
        {currentIndex >= 0 && <div className={`expedition-avatar ${activeExplorer(avatar) ? 'is-explorer' : ''} ${fireMotion ? "" : "is-paused"}`} style={{ left: `${POSITIONS[currentIndex][0]}%`, top: `${POSITIONS[currentIndex][1]}%` }} aria-label={live ? 'Tu personaje en el hito actual' : 'Tu personaje en una posición de ejemplo'}><VoxelAvatar config={avatar} size="lg" scene /></div>}
        <Link className={`expedition-summit-boss ${nearBoss ? 'is-near-summit' : ''}`} to="/avatar" aria-label="Conocer a El Regateador, jefe de muestra">
          <span className="expedition-boss-art"><LavaBoss animated={fireMotion}/></span>
          <strong>El Regateador</strong><small>Persuasión · jefe de muestra</small>
        </Link>
        <button className="expedition-discovery" aria-expanded={discovered} aria-controls="expedition-detour" onClick={() => setDiscovered(v => !v)}><Sparkles size={17}/>{discovered ? 'Sendero descubierto' : 'Explorar un desvío'}</button>
        <div className="expedition-legend" aria-label={live ? 'Estados del tramo actual' : 'Estados de la ruta de ejemplo'}><span className="expedition-earned-key"><Check size={13}/>Conquistado <b>{completed}</b></span><span><Route size={13}/>En curso <b>{stops.filter(n => n.status === 'in_progress').length}</b></span><span><LockKeyhole size={13}/>Bloqueado <b>{stops.filter(n => n.status === 'locked').length}</b></span></div>
      </div>
      <aside className="expedition-details" aria-label="Detalle del hito">
        <div key={selected.nodeId} className="expedition-mission" aria-live="polite">
          <p className="expedition-eyebrow">{live ? (selected.nodeId === currentId ? 'TU SIGUIENTE PASO' : 'HITO SELECCIONADO') : 'MISIÓN DE EJEMPLO'} · {STOP_LABELS[selected.status]}</p>
          {!live && <div className="expedition-stage" aria-label={`Etapa ${stage + 1} de 4: ${stages[stage]}. Ejemplo`}><div aria-hidden="true">{stages.map((s, i) => <span key={s} className={i === stage ? 'is-stage-selected' : ''}/>)}</div><small>Etapa {stage + 1}/4 · {stages[stage]}</small></div>}
          <h3>{selected.title}</h3>
          {selected.nodeId !== currentId && currentId && <button className="expedition-return" onClick={() => setSelectedId(currentId)}>Volver a mi hito actual <ArrowRight size={13}/></button>}<p>{selected.description || 'Consulta los detalles en tu ruta de aprendizaje.'}</p>
          {selected.estimatedDuration != null && selected.estimatedDuration > 0 && <p className="expedition-duration"><Clock3 size={15}/>{selected.estimatedDuration} min</p>}
          {selected.status === 'locked' && <p className="expedition-lock"><LockKeyhole size={15}/>{live ? 'Este hito aún no está habilitado. Consulta los requisitos en tu ruta.' : 'En este ejemplo, se abre al completar el hito anterior.'}</p>}
          {live ? <Link className="expedition-cta" to="/learning-path">{selected.status === 'locked' ? 'Ver requisitos en mi ruta' : 'Continuar en mi ruta'}<ArrowRight size={16}/></Link> : <Link className="expedition-cta" to="/skills-arena">Ir a Sala de habilidades<ArrowRight size={16}/></Link>}
        </div>
        <details className="expedition-boss-brief"><summary>¿Cómo preparo el reto del jefe?</summary><p>El Regateador representa Persuasión: practica cómo responder a objeciones explicando el valor de tu propuesta.</p><p>{live && firstBoss ? `Reto de tu ruta: ${firstBoss.title}. ${firstBoss.description || "Consulta sus requisitos en tu ruta."}` : "Ejemplo de reto: escucha una objeción, pregunta por la necesidad y construye tu argumento. Los requisitos reales aparecerán cuando tu ruta esté disponible."}</p></details>
        {xp != null && <ExpeditionReward avatar={avatar} xp={xp} nodes={live ? path.data!.nodes : []} reliable={live}/>}
        {xp == null && !discovered && <div className="expedition-boss expedition-reward"><img src={gearAsset(summitReward.id)} alt={summitReward.name}/><div><p className="expedition-eyebrow">RECOMPENSA · VISTA PREVIA</p><h3>{summitReward.name}</h3><p>{summitReward.requirement}</p><Link to="/avatar">Ver mi equipo <ArrowRight size={13}/></Link><small>Consultar no reclama ni desbloquea premios.</small></div></div>}
        <div hidden={!discovered} id="expedition-detour" className="expedition-detour"><p className="expedition-eyebrow"><Sparkles size={14}/>{discovered ? 'SENDERO DESCUBIERTO' : 'UN CAMINO EXTRA'}</p><p>{discovered ? 'Refuerza tus habilidades antes de seguir subiendo. Tú eliges el ejercicio.' : 'Explora el desvío del mapa para descubrir una práctica opcional.'}</p>{discovered && <Link to="/skills-arena">Elegir una práctica <ArrowRight size={14}/></Link>}<small>Explorar no entrega XP ni desbloquea equipo.</small></div>
        {children}
      </aside>
    </div>
  </section>;
}
