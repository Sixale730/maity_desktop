/**
 * Shim crítico: los services copiados de @maity/shared importan supabase desde
 * '../../api/client/supabase'. En el desktop, el cliente vive en @/lib/supabase.
 *
 * Adaptaciones necesarias:
 * - rpc() → .schema('public').rpc()  (los RPCs están en public, no en maity)
 * - from() → .schema('public').from() por defecto (las tablas de maity usan .schema('maity') explícito en los services)
 * - auth → passthrough al cliente real
 *
 * NO importar desde @maity/shared aquí — evita ciclos de importación.
 */

import { supabase as _supabase } from '@/lib/supabase'

// Crear un proxy que intercepta rpc() y from() para rutear al schema correcto
const supabaseProxy = new Proxy(_supabase, {
  get(target, prop) {
    if (prop === 'rpc') {
      // rpc() en schema public (los RPCs de auth/avatar/registration/billing están ahí)
      return (...args: Parameters<typeof target.rpc>) => target.schema('public').rpc(...args)
    }
    if (prop === 'from') {
      // from() en schema public por defecto; los services que necesitan 'maity' usan .schema('maity') explícito
      return (...args: Parameters<typeof target.from>) => target.schema('public').from(...args)
    }
    // auth, storage, realtime, schema → passthrough
    return (target as unknown as Record<string, unknown>)[prop as string]
  },
})

export const supabase = supabaseProxy
