'use client';
/* eslint-disable @next/next/no-img-element -- export estático (images.unoptimized): next/image no optimiza nada aquí; copia web tal cual */
// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/ExpeditionReward.tsx
// Adaptaciones desktop: 'use client'; react-router-dom → @/lib/router-compat (mapa web→desktop y externos a maity.cloud).
import { Link } from '@/lib/router-compat';
import { ArrowRight } from 'lucide-react';
import { parseAnimalDesign, deriveAdventure, COSMETIC_REWARDS, CLIMBING_GEAR_IDS, gearAsset, type AvatarConfiguration, type LearningPathNode } from '@maity/shared';
import { activeExplorer } from '@/features/avatar/components/explorer-design';
import { ExplorerPortrait } from '@/features/avatar/components/ExplorerPortrait';
import { AnimalPortrait } from '@/features/avatar/components/AnimalPortrait';

/** Read-only reward progress; equipment is managed on the avatar page. */
export function ExpeditionReward({ avatar, xp, nodes, reliable }: { avatar: Partial<AvatarConfiguration>; xp: number; nodes: LearningPathNode[]; reliable: boolean }) {
  const explorer = activeExplorer(avatar);
  const design = parseAnimalDesign(avatar.full_config?.animal_avatar);
  const adventure = deriveAdventure(xp, reliable ? nodes : []);
  const next = COSMETIC_REWARDS.find(r => CLIMBING_GEAR_IDS.includes(r.id) && !adventure.unlocked.includes(r.id));
  const reward = next ?? COSMETIC_REWARDS.find(r => r.id === 'pack')!;
  const canMeasure = reward.kind === 'level' ? Number.isFinite(xp) : reliable;
  const progress = reward.kind === 'level' ? xp : reward.kind === 'challenge' ? adventure.challenges : adventure.defeatedCount;
  const units = reward.kind === 'level' ? 'XP' : reward.kind === 'challenge' ? 'desafíos' : 'jefes';
  return <section className="expedition-reward-card" aria-label="Tu próxima recompensa">
    <div className="expedition-reward-art">
      {explorer ? <div className="expedition-fitting"><ExplorerPortrait design={explorer}/></div> : design && <div className="expedition-fitting"><AnimalPortrait design={design} scene /></div>}
      <img src={gearAsset(reward.id)} alt={reward.name}/>
    </div>
    <p className="expedition-eyebrow">{canMeasure && next ? 'PRÓXIMO EQUIPO' : 'EQUIPO · VISTA PREVIA'}</p>
    <h3>{reward.name}</h3><p>{reward.requirement}</p>
    {canMeasure && next && <p><strong>{Math.min(progress, reward.threshold)} / {reward.threshold} {units}</strong></p>}
    {!canMeasure && <small>Conecta tu ruta para conocer cuánto te falta.</small>}
    <small>Los premios se obtienen cumpliendo sus requisitos.</small>
    <Link className="expedition-equipment-link" to="/avatar?vista=logros">Ver mis logros <ArrowRight size={13}/></Link>
  </section>;
}
