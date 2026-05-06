'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2, X, Eye, EyeOff } from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { logger } from '@/lib/logger'
import { validatePassword } from '@/lib/password-validation'
import { PasswordStrengthIndicator } from './PasswordStrengthIndicator'

type AuthMode = 'signin' | 'signup' | 'reset'

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  )
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  )
}

const inputClass =
  'w-full h-11 px-3 rounded-lg border border-[#e7e7e9] dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-[#3a3a3c] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500'

const primaryButtonClass =
  'w-full h-12 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors'

const linkClass =
  'text-xs text-violet-600 hover:text-violet-700 dark:text-violet-400 cursor-pointer bg-transparent border-0 p-0'

const successBannerClass =
  'w-full bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-700 dark:text-green-300'

export function LoginScreen() {
  const {
    signInWithGoogle,
    signInWithApple,
    signInWithAzure,
    signInWithEmail,
    signUpWithEmail,
    sendPasswordReset,
    error,
    isLoading,
  } = useAuth()
  const [isSigningIn, setIsSigningIn] = useState(false)

  // Email/password form state
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Reset OAuth spinner when AuthContext reports an error
  useEffect(() => {
    if (error) {
      setIsSigningIn(false)
    }
  }, [error])

  // Listen for auth-server-stopped event from Rust
  useEffect(() => {
    const unlisten = listen<{ reason: string }>('auth-server-stopped', (event) => {
      if (event.payload.reason === 'timeout') {
        logger.debug('[LoginScreen] Auth server timed out, resetting spinner')
        setIsSigningIn(false)
      }
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode)
    setEmail('')
    setPassword('')
    setFullName('')
    setShowPassword(false)
    setSuccessMessage(null)
  }

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setSubmitting(true)
    try {
      await signInWithEmail(email, password)
    } catch {
      // Error already mapped to context error state
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password || !fullName) return
    if (!validatePassword(password).isValid) return
    setSubmitting(true)
    try {
      const result = await signUpWithEmail(email, password, fullName)
      if (result.needsVerification) {
        setSuccessMessage(`Te enviamos un correo a ${email}. Confirma tu cuenta para continuar.`)
      }
    } catch {
      // Error already mapped to context error state
    } finally {
      setSubmitting(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setSubmitting(true)
    let isNetworkError = false
    try {
      await sendPasswordReset(email)
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
      isNetworkError = msg.includes('network') || msg.includes('failed to fetch')
    } finally {
      // Generic success on success or Supabase errors (anti-enumeration); suppress on network errors so the user sees the red banner only.
      if (!isNetworkError) {
        setSuccessMessage('Si el correo existe, te enviamos un enlace para recuperar tu contraseña.')
      }
      setSubmitting(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true)
    try {
      await signInWithGoogle()
    } catch {
      setIsSigningIn(false)
    }
  }

  const handleAppleSignIn = async () => {
    setIsSigningIn(true)
    try {
      await signInWithApple()
    } catch {
      setIsSigningIn(false)
    }
  }

  const handleAzureSignIn = async () => {
    setIsSigningIn(true)
    try {
      await signInWithAzure()
    } catch {
      setIsSigningIn(false)
    }
  }

  const handleCancel = () => {
    setIsSigningIn(false)
  }

  const passwordValid = mode !== 'signup' || validatePassword(password).isValid
  const canSubmitSignIn = !!email && !!password && !submitting
  const canSubmitSignUp = !!email && !!password && !!fullName && passwordValid && !submitting
  const canSubmitReset = !!email && !submitting

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center z-50 overflow-y-auto">
      <div className="w-full max-w-md flex flex-col items-center px-6 py-8 space-y-8">
        {/* Logo / Brand */}
        <div className="flex flex-col items-center space-y-4">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#ff0050]/10 to-[#485df4]/10 dark:from-[#ff0050]/20 dark:to-[#485df4]/20 flex items-center justify-center shadow-lg">
            <img src="icon_128x128.png" alt="Maity" className="w-14 h-14" />
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-semibold text-[#000000] dark:text-white">
              Bienvenido a Maity
            </h1>
            <p className="text-base text-[#4a4a4c] dark:text-gray-300 max-w-sm mx-auto">
              Tu asistente de reuniones con IA
            </p>
          </div>
        </div>

        {/* OAuth Spinner Mode (full-screen-ish) */}
        {isSigningIn ? (
          <div className="w-full max-w-xs flex flex-col items-center space-y-4">
            <div className="w-full h-12 flex items-center justify-center gap-3 bg-white dark:bg-gray-800 border border-[#e7e7e9] dark:border-gray-700 rounded-lg">
              <Loader2 className="w-5 h-5 text-[#4a4a4c] dark:text-gray-300 animate-spin" />
              <span className="text-sm font-medium text-[#4a4a4c] dark:text-gray-300">
                Esperando autenticacion...
              </span>
            </div>
            <p className="text-xs text-center text-[#6a6a6d] dark:text-gray-400">
              Completa el inicio de sesion en tu navegador
            </p>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 text-xs text-[#6a6a6d] dark:text-gray-400 hover:text-[#3a3a3c] dark:hover:text-gray-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancelar</span>
            </button>
          </div>
        ) : (
          <div className="w-full max-w-xs space-y-5">
            {successMessage ? (
              <div className="space-y-4">
                <div className={successBannerClass}>{successMessage}</div>
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className={primaryButtonClass}
                >
                  Volver
                </button>
              </div>
            ) : (
              <>
                {/* Email/password forms */}
                {mode === 'signin' && (
                  <form onSubmit={handleEmailSignIn} className="space-y-3">
                    <div>
                      <label htmlFor="email" className="sr-only">
                        Correo electrónico
                      </label>
                      <input
                        id="email"
                        type="email"
                        autoComplete="email"
                        placeholder="Correo electrónico"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputClass}
                        disabled={submitting || isLoading}
                      />
                    </div>
                    <div className="relative">
                      <label htmlFor="password" className="sr-only">
                        Contraseña
                      </label>
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="Contraseña"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${inputClass} pr-10`}
                        disabled={submitting || isLoading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#6a6a6d] dark:text-gray-400 hover:text-[#3a3a3c] dark:hover:text-gray-200"
                        tabIndex={-1}
                        aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      type="submit"
                      disabled={!canSubmitSignIn}
                      className={primaryButtonClass}
                    >
                      {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>Iniciar sesión</span>
                    </button>
                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => switchMode('reset')}
                        className={linkClass}
                      >
                        ¿Olvidaste tu contraseña?
                      </button>
                      <button
                        type="button"
                        onClick={() => switchMode('signup')}
                        className={linkClass}
                      >
                        Crear cuenta
                      </button>
                    </div>
                  </form>
                )}

                {mode === 'signup' && (
                  <form onSubmit={handleSignUp} className="space-y-3">
                    <div>
                      <label htmlFor="fullName" className="sr-only">
                        Nombre completo
                      </label>
                      <input
                        id="fullName"
                        type="text"
                        autoComplete="name"
                        placeholder="Nombre completo"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className={inputClass}
                        disabled={submitting || isLoading}
                      />
                    </div>
                    <div>
                      <label htmlFor="email-signup" className="sr-only">
                        Correo electrónico
                      </label>
                      <input
                        id="email-signup"
                        type="email"
                        autoComplete="email"
                        placeholder="Correo electrónico"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputClass}
                        disabled={submitting || isLoading}
                      />
                    </div>
                    <div className="relative">
                      <label htmlFor="password-signup" className="sr-only">
                        Contraseña
                      </label>
                      <input
                        id="password-signup"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="Contraseña"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${inputClass} pr-10`}
                        disabled={submitting || isLoading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#6a6a6d] dark:text-gray-400 hover:text-[#3a3a3c] dark:hover:text-gray-200"
                        tabIndex={-1}
                        aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <PasswordStrengthIndicator password={password} />
                    <button
                      type="submit"
                      disabled={!canSubmitSignUp}
                      className={primaryButtonClass}
                    >
                      {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>Crear cuenta</span>
                    </button>
                    <div className="flex items-center justify-center pt-1">
                      <button
                        type="button"
                        onClick={() => switchMode('signin')}
                        className={linkClass}
                      >
                        Ya tengo cuenta
                      </button>
                    </div>
                  </form>
                )}

                {mode === 'reset' && (
                  <form onSubmit={handleReset} className="space-y-3">
                    <div>
                      <label htmlFor="email-reset" className="sr-only">
                        Correo electrónico
                      </label>
                      <input
                        id="email-reset"
                        type="email"
                        autoComplete="email"
                        placeholder="Correo electrónico"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputClass}
                        disabled={submitting || isLoading}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!canSubmitReset}
                      className={primaryButtonClass}
                    >
                      {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>Enviar correo de recuperación</span>
                    </button>
                    <div className="flex items-center justify-center pt-1">
                      <button
                        type="button"
                        onClick={() => switchMode('signin')}
                        className={linkClass}
                      >
                        Volver
                      </button>
                    </div>
                  </form>
                )}

                {/* Divider */}
                <div className="flex items-center gap-3 pt-1">
                  <div className="flex-1 h-px bg-[#e7e7e9] dark:bg-gray-700" />
                  <span className="text-xs text-[#6a6a6d] dark:text-gray-400">
                    o continúa con
                  </span>
                  <div className="flex-1 h-px bg-[#e7e7e9] dark:bg-gray-700" />
                </div>

                {/* OAuth buttons */}
                <div className="space-y-3">
                  {/* Google */}
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={isLoading || submitting}
                    className="w-full h-12 flex items-center justify-center gap-3 bg-white dark:bg-gray-800 border border-[#e7e7e9] dark:border-gray-700 rounded-lg shadow-sm hover:shadow-md hover:bg-[#f5f5f6] dark:hover:bg-gray-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <GoogleIcon className="w-5 h-5" />
                    <span className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">
                      Continuar con Google
                    </span>
                  </button>

                  {/* Apple */}
                  <button
                    type="button"
                    onClick={handleAppleSignIn}
                    disabled={isLoading || submitting}
                    className="w-full h-12 flex items-center justify-center gap-3 bg-black dark:bg-white border border-black dark:border-white rounded-lg shadow-sm hover:shadow-md hover:bg-gray-900 dark:hover:bg-gray-100 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <AppleIcon className="w-5 h-5 text-white dark:text-black" />
                    <span className="text-sm font-medium text-white dark:text-black">
                      Continuar con Apple
                    </span>
                  </button>

                  {/* Microsoft */}
                  <button
                    type="button"
                    onClick={handleAzureSignIn}
                    disabled={isLoading || submitting}
                    className="w-full h-12 flex items-center justify-center gap-3 bg-white dark:bg-gray-800 border border-[#e7e7e9] dark:border-gray-700 rounded-lg shadow-sm hover:shadow-md hover:bg-[#f5f5f6] dark:hover:bg-gray-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <MicrosoftIcon className="w-5 h-5" />
                    <span className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">
                      Continuar con Microsoft
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Error Display */}
        {error && !successMessage && (
          <div className="w-full max-w-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <p className="text-sm text-red-700 dark:text-red-300 text-center">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
