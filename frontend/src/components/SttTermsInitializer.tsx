'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '@/contexts/AuthContext';
import { fetchCompanySttTerms } from '@/services/sttTerms.service';
import { isAuxWindowPath } from '@/lib/auxWindows';
import { logger } from '@/lib/logger';

/**
 * Al tener sesión, baja los términos de corrección STT de la empresa del
 * usuario (RPC `public.get_stt_terms`) y los empuja a Rust, que los cachea
 * en su store y los aplica como post-proceso de la transcripción.
 *
 * Si la RPC falla (offline, etc.) NO se invoca nada: Rust ya cargó el cache
 * del store en el arranque (`init_from_store`), así que la última bajada
 * exitosa sigue corrigiendo.
 *
 * Mismo patrón que CloudSyncInitializer: gate `isAux` como defensa en
 * profundidad y efecto dependiente del booleano, no de `pathname`.
 */
export function SttTermsInitializer() {
  const { isAuthenticated, maityUser } = useAuth();
  const pathname = usePathname();
  const isAux = isAuxWindowPath(pathname);

  const userId = maityUser?.id ?? null;

  useEffect(() => {
    if (isAux || !isAuthenticated || !userId) return;

    let cancelled = false;
    void (async () => {
      const terms = await fetchCompanySttTerms();
      if (cancelled || terms === null) return;
      try {
        await invoke('set_stt_company_terms', { terms });
        logger.debug(`[SttTermsInitializer] ${terms.length} términos de empresa aplicados`);
      } catch (err) {
        logger.warn('[SttTermsInitializer] set_stt_company_terms falló:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAux, isAuthenticated, userId]);

  return null;
}
