import { createClient, SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase generic types require generated DB schema; using any is unavoidable without codegen
let supabaseInstance: SupabaseClient<any, any, any> | null = null

// Check if we're in a browser environment (not during SSG/SSR build)
const _isBrowser = typeof window !== 'undefined'

function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance
  }

  // Credenciales de producción de Supabase (seguras para cliente - la seguridad viene de RLS)
  // Las variables de entorno pueden usarse para override en desarrollo
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://nhlrtflkxoojvhbyocet.supabase.co'
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_9gJhm89FHYgH68xrW21Iqg_zuKXnFnq'

  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // Desktop app — no URL-based session detection
      flowType: 'pkce', // Use PKCE: redirects with ?code= in query params instead of tokens in hash fragment
    },
    db: { schema: 'maity' },
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
