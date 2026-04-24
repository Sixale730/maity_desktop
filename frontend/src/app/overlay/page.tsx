'use client'

import { useState, useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

interface CoachSuggestion {
  text: string
}

interface CoachError {
  error: string
}

export default function OverlayPage() {
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const prevSuggestionRef = useRef<string | null>(null)

  useEffect(() => {
    let unlistenSuggestion: (() => void) | undefined
    let unlistenError: (() => void) | undefined

    const setup = async () => {
      unlistenSuggestion = await listen<CoachSuggestion>('coach-suggestion', (event) => {
        const text = event.payload.text
        if (text && text !== prevSuggestionRef.current) {
          prevSuggestionRef.current = text
          setError(null)
          setIsVisible(false)
          // Small delay to trigger fade-in animation
          requestAnimationFrame(() => {
            setSuggestion(text)
            requestAnimationFrame(() => setIsVisible(true))
          })
        }
      })

      unlistenError = await listen<CoachError>('coach-error', (event) => {
        setError(event.payload.error)
      })
    }

    setup()

    return () => {
      unlistenSuggestion?.()
      unlistenError?.()
    }
  }, [])

  const handleClose = async () => {
    try {
      await invoke('stop_coach_overlay')
    } catch (e) {
      console.error('Failed to stop coach overlay:', e)
    }
  }

  return (
    <div className="w-full h-full p-2">
      <div className="bg-zinc-900/90 backdrop-blur-sm rounded-xl border border-zinc-700/50 h-full flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div
          data-tauri-drag-region
          className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/50 cursor-move shrink-0"
        >
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-medium text-zinc-400">Coach</span>
          </div>
          <button
            onClick={handleClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5 rounded hover:bg-zinc-800"
            title="Cerrar"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 px-3 py-2 overflow-y-auto min-h-0">
          {error && !suggestion ? (
            <p className="text-[12px] text-amber-400/80 leading-relaxed">
              {error}
            </p>
          ) : suggestion ? (
            <div
              className={`transition-opacity duration-500 ease-in-out ${
                isVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <p className="text-[12px] text-zinc-200 leading-relaxed whitespace-pre-line">
                {suggestion}
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-zinc-500 italic leading-relaxed">
              Escuchando conversacion...
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-1 border-t border-zinc-800/50 shrink-0">
          <span className="text-[9px] text-zinc-600">
            Powered by Ollama
          </span>
        </div>
      </div>
    </div>
  )
}
