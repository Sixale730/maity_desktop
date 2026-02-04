'use client'

import React, { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2 } from 'lucide-react'

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

export function LoginScreen() {
  const { signInWithGoogle, error, isLoading } = useAuth()
  const [isSigningIn, setIsSigningIn] = useState(false)

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true)
    try {
      await signInWithGoogle()
    } finally {
      // Keep spinner until deep-link callback completes the flow
      // If there's an error, the error state from AuthContext will show
      // Only reset if there was an error (otherwise the callback will handle it)
      setTimeout(() => {
        setIsSigningIn(false)
      }, 30000) // 30s timeout as safety net
    }
  }

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center z-50 overflow-hidden">
      <div className="w-full max-w-md flex flex-col items-center px-6 py-6 space-y-10">
        {/* Logo / Brand */}
        <div className="flex flex-col items-center space-y-4">
          <div className="w-20 h-20 rounded-2xl bg-black dark:bg-white flex items-center justify-center shadow-lg">
            <span className="text-3xl font-bold text-white dark:text-black">M</span>
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-semibold text-[#000000] dark:text-white">
              Bienvenido a Maity
            </h1>
            <p className="text-base text-[#4a4a4c] dark:text-gray-300 max-w-sm mx-auto">
              Tu asistente de reuniones con IA
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="w-16 h-px bg-[#b0b0b3] dark:bg-gray-600" />

        {/* Sign-in Section */}
        <div className="w-full max-w-xs space-y-4">
          <button
            onClick={handleGoogleSignIn}
            disabled={isSigningIn || isLoading}
            className="w-full h-12 flex items-center justify-center gap-3 bg-white dark:bg-gray-800 border border-[#e7e7e9] dark:border-gray-700 rounded-lg shadow-sm hover:shadow-md hover:bg-[#f5f5f6] dark:hover:bg-gray-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSigningIn ? (
              <>
                <Loader2 className="w-5 h-5 text-[#4a4a4c] dark:text-gray-300 animate-spin" />
                <span className="text-sm font-medium text-[#4a4a4c] dark:text-gray-300">
                  Esperando autenticacion...
                </span>
              </>
            ) : (
              <>
                <GoogleIcon className="w-5 h-5" />
                <span className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">
                  Continuar con Google
                </span>
              </>
            )}
          </button>

          {isSigningIn && (
            <p className="text-xs text-center text-[#6a6a6d] dark:text-gray-400">
              Completa el inicio de sesion en tu navegador
            </p>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="w-full max-w-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <p className="text-sm text-red-700 dark:text-red-300 text-center">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
