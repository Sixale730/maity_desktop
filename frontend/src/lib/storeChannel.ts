/**
 * Canal Microsoft Store (MSIX) — constantes y fuente remota de "última versión".
 *
 * Bajo identidad de paquete el updater de GitHub NO puede correr (instalaría el
 * setup.exe NSIS como segunda copia Win32), así que la app solo AVISA y manda
 * al usuario a la Store. La versión publicada se lee de
 * `maity.system_config['desktop_store_latest_version']`, NO del `latest.json`
 * de GitHub Releases: ese manifiesto sigue al canal NSIS, que puede ir varias
 * versiones DETRÁS de la Store (ago-2026: GitHub v0.2.52 vs Store 0.2.57), así
 * que compararlo diría "al día" para siempre. Issue #71.
 *
 * La fila la bumpea un humano con SQL directo cuando Partner Center marca la
 * submission como PUBLICADA (no al enviarla): ver `.claude/skills/store-msix/SKILL.md`
 * → "Go-live". `admin_update_system_config` no sirve (whitelist billing_/rate_limit_).
 */

import { supabase } from '@/lib/supabase';

/** Store ID del producto "Maity" en Partner Center. */
export const STORE_PRODUCT_ID = '9NTKJ5X6230F';

/** Página pública del producto (navegador). */
export const STORE_PRODUCT_PAGE_URL = `https://apps.microsoft.com/detail/${STORE_PRODUCT_ID}`;

/**
 * Deep link a "Descargas y actualizaciones" de la app Microsoft Store. Su botón
 * "Obtener actualizaciones" fuerza el check — es el mismo workaround manual del
 * issue. El PDP (`ms-windows-store://pdp/?ProductId=...`) a veces solo muestra
 * "Abrir" aunque haya update pendiente.
 */
export const STORE_UPDATES_DEEP_LINK = 'ms-windows-store://downloadsandupdates';

/** Clave en `maity.system_config` con la última versión publicada en la Store. */
export const STORE_LATEST_VERSION_KEY = 'desktop_store_latest_version';

export type StoreVersionLookup =
  /** Sin sesión Supabase: la tabla exige `authenticated`. No es error — reintentar tras login. */
  | { status: 'no-session' }
  /** La fila no existe (o está vacía): nadie ha hecho el seed. */
  | { status: 'missing' }
  | { status: 'ok'; version: string };

/**
 * Lee la última versión publicada en la Store. Lanza en errores de red/RLS
 * para que el caller lo trate igual que una falla del updater de GitHub.
 */
export async function fetchStoreLatestVersion(): Promise<StoreVersionLookup> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { status: 'no-session' };

  // `.schema('maity')` EXPLÍCITO: el default del cliente es `public` (#70) y
  // `lib/supabase.test.ts` falla el build de tests si falta.
  const { data, error } = await supabase
    .schema('maity')
    .from('system_config')
    .select('value')
    .eq('key', STORE_LATEST_VERSION_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(`system_config read failed: ${error.message}`);
  }

  const value = typeof data?.value === 'string' ? data.value.trim() : '';
  return value ? { status: 'ok', version: value } : { status: 'missing' };
}
