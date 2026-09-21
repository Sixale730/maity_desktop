// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/expedition-model.ts
// Copia tal cual (sin adaptaciones).
import type { LearningPathNode } from '@maity/shared';

export type ExpeditionStop = Pick<LearningPathNode, 'nodeId' | 'title' | 'description' | 'status' | 'nodeType' | 'estimatedDuration'>;

/** Illustrative route only; never persisted or included in earned progress. */
export const SAMPLE_STOPS: ExpeditionStop[] = [
  { nodeId: 'sample-base', title: 'Campamento base', description: 'Conoce el objetivo de tu ascenso.', status: 'completed', nodeType: 'resource', estimatedDuration: null },
  { nodeId: 'sample-listen', title: 'Escucha antes de responder', description: 'Practica cómo descubrir la necesidad detrás de una objeción.', status: 'in_progress', nodeType: 'scenario', estimatedDuration: null },
  { nodeId: 'sample-value', title: 'Construye tu argumento', description: 'Conecta tu propuesta con lo que necesita la otra persona.', status: 'locked', nodeType: 'quiz', estimatedDuration: null },
  { nodeId: 'sample-questions', title: 'Pregunta para comprender', description: 'Ejemplo de práctica: explora qué necesita la otra persona antes de ofrecer una solución.', status: 'locked', nodeType: 'scenario', estimatedDuration: null },
  { nodeId: 'sample-camp', title: 'Campamento de reflexión', description: 'Revisa lo aprendido y elige qué habilidad seguir practicando.', status: 'locked', nodeType: 'resource', estimatedDuration: null },
  { nodeId: 'sample-practice', title: 'Ponlo en práctica', description: 'Lleva tus habilidades a una conversación de práctica.', status: 'locked', nodeType: 'scenario', estimatedDuration: null },
  { nodeId: 'sample-objections', title: 'Escucha una objeción', description: 'Ejemplo de reto: responde con claridad y sin perder de vista la necesidad del cliente.', status: 'locked', nodeType: 'scenario', estimatedDuration: null },
  { nodeId: 'sample-review', title: 'Prepara tu ascenso final', description: 'Repasa tus aprendizajes antes del reto de la cumbre.', status: 'locked', nodeType: 'quiz', estimatedDuration: null },
  { nodeId: 'sample-summit', title: 'El reto de la cumbre', description: 'Una prueba final para reunir lo aprendido.', status: 'locked', nodeType: 'checkpoint', estimatedDuration: null },
];

export function expeditionWindow(nodes: LearningPathNode[]) {
  const sorted = [...nodes].sort((a, b) => a.orderIndex - b.orderIndex || a.nodeId.localeCompare(b.nodeId));
  const current = sorted.findIndex(n => n.status === 'in_progress');
  const next = current >= 0 ? current : sorted.findIndex(n => n.status === 'available');
  // A bounded viewport, never a claim that this represents the entire learning path.
  const start = Math.max(0, (next >= 0 ? next : Math.max(0, sorted.length - 1)) - 1);
  return { stops: sorted.slice(start, start + 9), currentId: next >= 0 ? sorted[next].nodeId : null, start, total: sorted.length };
}

export const EXPEDITION_POSITIONS = [[20, 79], [36, 70], [59, 64], [67, 54], [48, 47], [35, 39], [48, 31], [59, 23], [52, 14]];

/** Smooth geometry through the same anchors as the interactive buttons. */
export function expeditionTrail(points: number[][]): string {
  if (!points.length) return '';
  return points.slice(1).reduce((path, end, i) => {
    const start = points[i], previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 2)];
    return `${path} C${start[0] + (end[0] - previous[0]) / 6},${start[1] + (end[1] - previous[1]) / 6} ${end[0] - (next[0] - start[0]) / 6},${end[1] - (next[1] - start[1]) / 6} ${end[0]},${end[1]}`;
  }, `M${points[0].join(',')}`);
}

export const STOP_LABELS = { completed: 'Completado', in_progress: 'En curso', available: 'Disponible', locked: 'Bloqueado', skipped: 'Omitido' } as const;

/** Reuse the full route's curves so the earned overlay cannot drift off the road. */
export function conqueredTrail(stops: ExpeditionStop[], currentId: string | null): string[] {
  const points = EXPEDITION_POSITIONS.slice(0, stops.length);
  const segments = expeditionTrail(points).split(' C').slice(1);
  return segments.flatMap((segment, index) => {
    const from = stops[index], to = stops[index + 1];
    const earned = from.status === 'completed' &&
      (to.status === 'completed' || (to.nodeId === currentId && ['available', 'in_progress'].includes(to.status)));
    return earned ? [`M${points[index].join(',')} C${segment}`] : [];
  });
}
