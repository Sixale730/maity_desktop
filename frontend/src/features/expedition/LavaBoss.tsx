'use client';
/* eslint-disable @next/next/no-img-element -- export estático (images.unoptimized): next/image no optimiza nada aquí; copia web tal cual */
// Origen: web Sixale730/maity@3ef2914 src/features/expedition/LavaBoss.tsx
// Adaptaciones desktop: 'use client'.
import type { CSSProperties } from 'react';
import './lava-boss.css';

/** Decoration only: no combat state or progression changes. */
export function LavaBoss({ animated = true }: { animated?: boolean }) {
  return <span className={`lava-boss ${animated ? 'lava-boss-live' : ''}`}>
    <span className="lava-boss-heat" aria-hidden="true"/>
    <img className="lava-boss-image" src="/assets/expedition/lava-golem-transparent-v1.webp" alt="El Regateador, gólem de roca volcánica y lava" width="936" height="1024"/>
    <span className="lava-boss-core" aria-hidden="true"/>
    <span className="lava-boss-embers" aria-hidden="true">{[16, 25, 35, 43, 59, 68, 77, 84].map((x, i) => <i key={x} style={{ '--ember-x': `${x}%`, '--ember-delay': `${i * -.61}s`, '--ember-drift': `${i % 2 ? 9 : -8}px` } as CSSProperties}/>)}</span>
  </span>;
}
