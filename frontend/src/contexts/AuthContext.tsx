'use client'

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Session, User } from '@supabase/supabase-js'
import type { MaityUser } from '@/types/auth'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { onOpenUrl } from '@tauri-apps/plugin-deep-link'

interface AuthContextType {
  session: Session | null
  user: User | null
  maityUser: MaityUser | null
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null
  maityUserError: string | null
  signInWithGoogle: () => Promise<void>
  signInWithApple: () => Promise<void>
  signInWithAzure: () => Promise<void>
  signOut: () => Promise<void>
  retryFetchMaityUser: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/**
 * Extract access_token and refresh_token from a deep-link callback URL.
 * Supabase redirects to: maity://auth/callback#access_token=...&refresh_token=...
 */
function extractTokensFromUrl(url: string): { accessToken: string; refreshToken: string } | null {
  try {
    // The tokens are in the fragment (after #)
    const hashIndex = url.indexOf('#')
    if (hashIndex === -1) return null

    const fragment = url.substring(hashIndex + 1)
    const params = new URLSearchParams(fragment)
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    if (accessToken && refreshToken) {
      return { accessToken, refreshToken }
    }
    return null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [maityUser, setMaityUser] = useState<MaityUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [maityUserError, setMaityUserError] = useState<string | null>(null)
  const isHandlingCallback = useRef(false)
  const fetchMaityUserPromise = useRef<Promise<void> | null>(null)

  const isAuthenticated = !!session && !!user

  // Fetch or create the maity.users record for the authenticated user
  const fetchOrCreateMaityUser = useCallback(async (authUser: User) => {
    // Promise dedup: if a fetch is already in progress, wait for it instead of running another
    if (fetchMaityUserPromise.current) {
      console.log('[Auth] fetchOrCreateMaityUser already in progress, awaiting existing promise')
      await fetchMaityUserPromise.current
      return
    }

    const doFetch = async () => {
      setMaityUserError(null)
      try {
        // Try to fetch existing maity.users record
        const { data, error: fetchError } = await supabase
          .from('users')
          .select('id, auth_id, name, email, status, created_at, updated_at')
          .eq('auth_id', authUser.id)
          .single()

        if (data) {
          setMaityUser(data as MaityUser)
          return
        }

        // If not found (PGRST116 = no rows), create a new record
        if (fetchError && fetchError.code === 'PGRST116') {
          const userName =
            authUser.user_metadata?.full_name ||
            authUser.user_metadata?.name ||
            authUser.email?.split('@')[0] ||
            ''

          const email = authUser.email || ''
          const domain = email.split('@')[1]?.toLowerCase() || ''
          const TRUSTED_DOMAINS = ['asertio.mx', 'maity.cloud']
          const initialStatus = TRUSTED_DOMAINS.includes(domain) ? 'ACTIVE' : 'PENDING_APPROVAL'

          const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
              auth_id: authUser.id,
              name: userName,
              email: authUser.email || null,
              status: initialStatus,
            })
            .select('id, auth_id, name, email, status, created_at, updated_at')
            .single()

          if (createError) {
            // Handle unique constraint violation (concurrent insert race)
            if (createError.code === '23505') {
              console.log('[Auth] Unique constraint hit (concurrent insert), re-fetching user')
              const { data: existingUser, error: refetchError } = await supabase
                .from('users')
                .select('id, auth_id, name, email, status, created_at, updated_at')
                .eq('auth_id', authUser.id)
                .single()

              if (existingUser) {
                setMaityUser(existingUser as MaityUser)
                return
              }
              if (refetchError) {
                console.error('[Auth] Failed to re-fetch after unique constraint:', refetchError)
                setMaityUserError('No se pudo cargar tu cuenta. Verifica tu conexión e intenta de nuevo.')
                return
              }
            }

            console.error('[Auth] Failed to create maity user:', createError)
            setMaityUserError('No se pudo crear tu cuenta. Verifica tu conexión e intenta de nuevo.')
            return
          }

          setMaityUser(newUser as MaityUser)
          return
        }

        if (fetchError) {
          console.error('[Auth] Failed to fetch maity user:', fetchError)
          setMaityUserError('No se pudo cargar tu cuenta. Verifica tu conexión e intenta de nuevo.')
        }
      } catch (err) {
        console.error('[Auth] Error in fetchOrCreateMaityUser:', err)
        setMaityUserError('Error inesperado al cargar tu cuenta. Verifica tu conexión e intenta de nuevo.')
      }
    }

    const promise = doFetch()
    fetchMaityUserPromise.current = promise
    try {
      await promise
    } finally {
      // Only clear if it's still our promise (not replaced by another call)
      if (fetchMaityUserPromise.current === promise) {
        fetchMaityUserPromise.current = null
      }
    }
  }, [])

  // Ref to avoid re-subscription of auth listener when callback changes
  const fetchOrCreateMaityUserRef = useRef(fetchOrCreateMaityUser)
  useEffect(() => {
    fetchOrCreateMaityUserRef.current = fetchOrCreateMaityUser
  }, [fetchOrCreateMaityUser])

  // Retry fetching maityUser with the current authenticated user
  const retryFetchMaityUser = useCallback(() => {
    if (user) {
      fetchOrCreateMaityUserRef.current(user)
    }
  }, [user])

  // Handle a deep-link callback URL containing OAuth tokens
  const handleDeepLinkCallback = useCallback(async (url: string) => {
    if (!url.startsWith('maity://auth/callback')) return
    if (isHandlingCallback.current) return
    isHandlingCallback.current = true

    console.log('[Auth] Processing OAuth callback')
    setError(null)

    const tokens = extractTokensFromUrl(url)
    if (!tokens) {
      console.error('[Auth] Failed to extract tokens from callback URL')
      setError('Failed to complete sign-in. Please try again.')
      isHandlingCallback.current = false
      return
    }

    try {
      const { data, error: sessionError } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      })

      if (sessionError) {
        console.error('[Auth] Failed to set session:', sessionError)
        setError('Failed to complete sign-in. Please try again.')
      } else if (data.session) {
        console.log('[Auth] Session established successfully')
        setSession(data.session)
        setUser(data.session.user)
        await fetchOrCreateMaityUserRef.current(data.session.user)
      }
    } catch (err) {
      console.error('[Auth] Error setting session:', err)
      setError('An unexpected error occurred during sign-in.')
    } finally {
      isHandlingCallback.current = false
    }
  }, [])

  // Initialize auth: restore session and subscribe to changes
  useEffect(() => {
    let authSubscription: { data: { subscription: { unsubscribe: () => void } } } | null = null
    let isMounted = true

    const initialize = async () => {
      try {
        // Restore existing session
        const { data: { session: existingSession } } = await supabase.auth.getSession()
        if (existingSession && isMounted) {
          console.log('[Auth] Restored existing session')
          setSession(existingSession)
          setUser(existingSession.user)
          await fetchOrCreateMaityUserRef.current(existingSession.user)
        }
      } catch (err) {
        console.error('[Auth] Failed to restore session:', err)
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }

      // Subscribe to auth state changes (token refresh, sign-out, etc.)
      authSubscription = supabase.auth.onAuthStateChange(async (event, newSession) => {
        console.log('[Auth] Auth state changed:', event, 'session:', !!newSession)

        if (!isMounted) return

        setSession(newSession)
        setUser(newSession?.user ?? null)

        if (newSession?.user) {
          // Skip if a callback handler (processAuthCode/processAuthTokens/handleDeepLinkCallback)
          // is already active — it will call fetchOrCreateMaityUser after establishing the session
          if (isHandlingCallback.current) {
            console.log('[Auth] Skipping fetchOrCreateMaityUser in onAuthStateChange (callback handler active)')
          } else {
            await fetchOrCreateMaityUserRef.current(newSession.user)
          }
        } else {
          setMaityUser(null)
        }
      })
    }

    initialize()

    return () => {
      isMounted = false
      authSubscription?.data.subscription.unsubscribe()
    }
  }, []) // Sin dependencias - solo se ejecuta una vez al montar

  // Helper: process tokens received from OAuth server (shared by listener and polling fallback)
  const processAuthTokens = useCallback(async (access_token: string, refresh_token: string) => {
    if (isHandlingCallback.current) return
    isHandlingCallback.current = true

    console.log('[Auth] Processing auth tokens')
    setError(null)

    try {
      const { data, error: sessionError } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      })

      if (sessionError) {
        console.error('[Auth] Failed to set session from tokens:', sessionError)
        setError('Failed to complete sign-in. Please try again.')
      } else if (data.session) {
        console.log('[Auth] Session established from tokens')
        setSession(data.session)
        setUser(data.session.user)
        await fetchOrCreateMaityUserRef.current(data.session.user)
      }
    } catch (err) {
      console.error('[Auth] Error setting session from tokens:', err)
      setError('An unexpected error occurred during sign-in.')
    } finally {
      isHandlingCallback.current = false
    }
  }, [])

  // Listen for auth tokens from the localhost OAuth server (primary on Windows)
  useEffect(() => {
    const unlistenTokens = listen<{ access_token: string; refresh_token: string }>(
      'auth-tokens-received',
      async (event) => {
        const { access_token, refresh_token } = event.payload
        await processAuthTokens(access_token, refresh_token)
      }
    )

    // Polling fallback: check if tokens arrived before listener was ready
    invoke<{ access_token: string; refresh_token: string } | null>('get_pending_auth_tokens')
      .then(async (pending) => {
        if (pending) {
          console.log('[Auth] Found pending auth tokens via polling fallback')
          await processAuthTokens(pending.access_token, pending.refresh_token)
        }
      })
      .catch((err) => {
        console.log('[Auth] get_pending_auth_tokens not available:', err)
      })

    return () => {
      unlistenTokens.then((fn) => fn())
    }
  }, [processAuthTokens])

  // Helper: process PKCE auth code (shared by listener and polling fallback)
  const processAuthCode = useCallback(async (code: string) => {
    if (isHandlingCallback.current) return
    isHandlingCallback.current = true

    console.log('[Auth] Processing PKCE code')
    setError(null)

    try {
      const { data, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)

      if (sessionError) {
        console.error('[Auth] Failed to exchange PKCE code for session:', sessionError)
        setError('Failed to complete sign-in. Please try again.')
      } else if (data.session) {
        console.log('[Auth] Session established via PKCE code exchange')
        setSession(data.session)
        setUser(data.session.user)
        await fetchOrCreateMaityUserRef.current(data.session.user)
      }
    } catch (err) {
      console.error('[Auth] Error exchanging PKCE code:', err)
      setError('An unexpected error occurred during sign-in.')
    } finally {
      isHandlingCallback.current = false
    }
  }, [])

  // Listen for PKCE auth code from the localhost OAuth server
  useEffect(() => {
    const unlistenCode = listen<{ code: string }>(
      'auth-code-received',
      async (event) => {
        await processAuthCode(event.payload.code)
      }
    )

    // Polling fallback: check if a code arrived before listener was ready
    invoke<string | null>('get_pending_auth_code')
      .then(async (pendingCode) => {
        if (pendingCode) {
          console.log('[Auth] Found pending PKCE code via polling fallback')
          await processAuthCode(pendingCode)
        }
      })
      .catch((err) => {
        console.log('[Auth] get_pending_auth_code not available:', err)
      })

    return () => {
      unlistenCode.then((fn) => fn())
    }
  }, [processAuthCode])

  // Listen for deep-link events as fallback (macOS: onOpenUrl, Windows: single-instance event)
  useEffect(() => {
    // macOS/iOS: onOpenUrl fires directly
    let cleanupOpenUrl: (() => void) | null = null
    onOpenUrl((urls) => {
      for (const url of urls) {
        if (typeof url === 'string' && url.startsWith('maity://auth/callback')) {
          handleDeepLinkCallback(url)
          break
        }
      }
    }).then((cleanup) => {
      cleanupOpenUrl = cleanup
    }).catch((err) => {
      // On Windows this may not be available — deep links come via single-instance
      console.log('[Auth] onOpenUrl not available (expected on Windows):', err)
    })

    // Windows/Linux: single-instance plugin forwards deep-link URLs as events
    const unlistenPromise = listen<string>('deep-link-received', (event) => {
      const url = event.payload
      if (url.startsWith('maity://auth/callback')) {
        handleDeepLinkCallback(url)
      }
    })

    return () => {
      cleanupOpenUrl?.()
      unlistenPromise.then((fn) => fn())
    }
  }, [handleDeepLinkCallback])

  const signInWithGoogle = useCallback(async () => {
    setError(null)

    try {
      // Start localhost OAuth server for reliable callback (especially on Windows)
      let redirectTo = 'maity://auth/callback' // fallback
      try {
        const port = await invoke<number>('start_oauth_server')
        redirectTo = `http://127.0.0.1:${port}/auth/callback`
        console.log('[Auth] Localhost OAuth server started on port', port)
      } catch (serverErr) {
        console.warn('[Auth] Failed to start OAuth server, falling back to deep-link:', serverErr)
      }

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          skipBrowserRedirect: true,
          redirectTo,
        },
      })

      if (oauthError) {
        console.error('[Auth] OAuth error:', oauthError)
        setError('Failed to start Google sign-in. Please try again.')
        return
      }

      if (data.url) {
        // Open the OAuth URL in the system browser
        console.log('[Auth] Opening OAuth URL in system browser:', data.url)
        await invoke('open_external_url', { url: data.url })
      }
    } catch (err) {
      console.error('[Auth] Error starting Google sign-in:', err)
      setError('Failed to start Google sign-in. Please check your internet connection.')
    }
  }, [])

  const signInWithApple = useCallback(async () => {
    setError(null)
    try {
      let redirectTo = 'maity://auth/callback'
      try {
        const port = await invoke<number>('start_oauth_server')
        redirectTo = `http://127.0.0.1:${port}/auth/callback`
        console.log('[Auth] Localhost OAuth server started on port', port)
      } catch (serverErr) {
        console.warn('[Auth] Failed to start OAuth server, falling back to deep-link:', serverErr)
      }

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          skipBrowserRedirect: true,
          redirectTo,
        },
      })

      if (oauthError) {
        console.error('[Auth] OAuth error:', oauthError)
        setError('No se pudo iniciar el inicio de sesión con Apple. Intenta de nuevo.')
        return
      }
      if (data.url) {
        console.log('[Auth] Opening Apple OAuth URL in system browser')
        await invoke('open_external_url', { url: data.url })
      }
    } catch (err) {
      console.error('[Auth] Error starting Apple sign-in:', err)
      setError('No se pudo iniciar el inicio de sesión con Apple. Verifica tu conexión.')
    }
  }, [])

  const signInWithAzure = useCallback(async () => {
    setError(null)
    try {
      let redirectTo = 'maity://auth/callback'
      try {
        const port = await invoke<number>('start_oauth_server')
        redirectTo = `http://127.0.0.1:${port}/auth/callback`
        console.log('[Auth] Localhost OAuth server started on port', port)
      } catch (serverErr) {
        console.warn('[Auth] Failed to start OAuth server, falling back to deep-link:', serverErr)
      }

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          skipBrowserRedirect: true,
          redirectTo,
          scopes: 'email',
        },
      })

      if (oauthError) {
        console.error('[Auth] OAuth error:', oauthError)
        setError('No se pudo iniciar el inicio de sesión con Microsoft. Intenta de nuevo.')
        return
      }
      if (data.url) {
        console.log('[Auth] Opening Azure OAuth URL in system browser')
        await invoke('open_external_url', { url: data.url })
      }
    } catch (err) {
      console.error('[Auth] Error starting Azure sign-in:', err)
      setError('No se pudo iniciar el inicio de sesión con Microsoft. Verifica tu conexión.')
    }
  }, [])

  const signOut = useCallback(async () => {
    console.log('[Auth] signOut called')
    try {
      // Reset flags BEFORE calling signOut to ensure clean state
      isHandlingCallback.current = false
      setError(null)
      setMaityUserError(null)

      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('[Auth] Supabase signOut error:', error)
      }

      // Siempre limpiar estado local (no depender del listener onAuthStateChange)
      // ya que puede no dispararse si la sesión ya era inválida
      console.log('[Auth] Clearing local auth state')
      setSession(null)
      setUser(null)
      setMaityUser(null)
    } catch (err) {
      console.error('[Auth] Error signing out:', err)
      // Limpiar estado manualmente en caso de excepción
      setSession(null)
      setUser(null)
      setMaityUser(null)
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        maityUser,
        isLoading,
        isAuthenticated,
        error,
        maityUserError,
        signInWithGoogle,
        signInWithApple,
        signInWithAzure,
        signOut,
        retryFetchMaityUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
