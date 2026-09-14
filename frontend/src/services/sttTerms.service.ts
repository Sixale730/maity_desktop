/**
 * Términos de corrección STT por empresa.
 *
 * La tabla `maity.company_stt_terms` la administra Maity por SQL; el desktop
 * solo LEE vía la RPC `public.get_stt_terms` (SECURITY DEFINER: resuelve la
 * empresa del usuario server-side con auth.uid(), no hace falta company_id en
 * el cliente). Los pares se empujan a Rust (`set_stt_company_terms`), que los
 * cachea en su store para sesiones offline y los aplica como post-proceso de
 * la transcripción (ver `stt_corrections.rs`).
 */
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export interface SttTerm {
  wrong: string;
  right: string;
}

function isSttTerm(value: unknown): value is SttTerm {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SttTerm).wrong === 'string' &&
    typeof (value as SttTerm).right === 'string'
  );
}

/**
 * Baja los términos de la empresa del usuario autenticado.
 * Devuelve `[]` en cualquier error (offline, sin empresa, RPC ausente):
 * el caller NO debe invocar a Rust en ese caso para no pisar el cache local.
 */
export async function fetchCompanySttTerms(): Promise<SttTerm[] | null> {
  try {
    const { data, error } = await supabase.schema('public').rpc('get_stt_terms');
    if (error) {
      logger.warn('[sttTerms] get_stt_terms falló:', error.message);
      return null;
    }
    if (!Array.isArray(data)) {
      return [];
    }
    return data.filter(isSttTerm);
  } catch (err) {
    logger.warn('[sttTerms] get_stt_terms excepción:', err);
    return null;
  }
}
