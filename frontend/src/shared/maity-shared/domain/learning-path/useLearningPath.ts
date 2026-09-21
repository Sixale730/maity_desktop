/**
 * `useLearningPath` — STUB desktop "sin ruta asignada".
 *
 * Origen: web Sixale730/maity@3ef2914 packages/shared/src/domain/learning-path/hooks/useLearningPath.ts
 * Adaptación: la web consulta el RPC `get_user_learning_path`, que en producción
 * responde PGRST202 (no existe el wrapper `public.*` y el desktop no llama RPC
 * pelones — ver docs/NUBE_CUENTAS_SYNC.md). En vez de una llamada que siempre
 * falla, este stub devuelve "sin ruta": `ExpeditionPilot` muestra el mapa de
 * EJEMPLO ("Aún no hay una ruta asignada…") y `ExpeditionReward` no inventa
 * progreso. NO hace ninguna llamada de red.
 *
 * Mismo shape que la parte de `UseQueryResult` que consume la web (`data`,
 * `isLoading`, `error`, `isFetching`, `refetch`). Cuando exista el RPC, se
 * cambia este archivo por la copia del hook real y nada más.
 */
import type { UserLearningPath } from './learning-path.types';

export interface LearningPathQuery {
  data: UserLearningPath | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

const NO_PATH: LearningPathQuery = Object.freeze({
  data: undefined,
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: () => Promise.resolve(undefined),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- misma firma que la web
export function useLearningPath(_userId: string | undefined): LearningPathQuery {
  return NO_PATH;
}
