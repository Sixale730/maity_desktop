import { createClient, SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase generic types require generated DB schema; using any is unavoidable without codegen
let supabaseInstance: SupabaseClient<any, any, any> | null = null

// Check if we're in a browser environment (not during SSG/SSR build)
const _isBrowser = typeof window !== 'undefined'

// Credenciales de producción de Supabase (seguras para cliente - la seguridad viene de RLS)
// Las variables de entorno pueden usarse para override en desarrollo.
// Exportadas porque Rust también las necesita: `cloud_sync_set_session` siembra
// url + anon key en el proceso nativo para que el consumidor de sync pueda
// refrescar la sesión con la ventana oculta (ver cloud_sync/session.rs).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://nhlrtflkxoojvhbyocet.supabase.co'
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_9gJhm89FHYgH68xrW21Iqg_zuKXnFnq'

function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance
  }

  supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // Desktop app — no URL-based session detection
      flowType: 'pkce', // Use PKCE: redirects with ?code= in query params instead of tokens in hash fragment
    },
    // `public` es el perimetro mediado: los clientes entran por wrappers
    // public.* (SECURITY DEFINER) que es donde vive la autorizacion. El schema
    // `maity` esta cerrado a los roles de cliente desde el hardening de la DB
    // (issue web #143), asi que un .rpc() que caiga ahi devuelve 403 -- y casi
    // todos los call sites tragan el error en silencio. Ver issue #70.
    //
    // Las TABLAS de maity si siguen accesibles (gobernadas por RLS): se piden
    // con .schema('maity') EXPLICITO. No confiar en el default para eso.
    db: { schema: 'public' },
  })

  return supabaseInstance
}

// Lazy-initialized getter to avoid build-time errors when env vars are missing
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseClient()
    const value = (client as unknown as Record<string | symbol, unknown>)[prop]
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
})
