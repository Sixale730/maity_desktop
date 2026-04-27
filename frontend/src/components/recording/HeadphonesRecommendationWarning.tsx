'use client'
import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { X, Headphones } from 'lucide-react'

interface AudioOutputInfo {
  device_name: string
  is_bluetooth: boolean
  sample_rate: number | null
  device_type: string
}

interface HeadphonesRecommendationWarningProps {
  enabled?: boolean
  checkInterval?: number
}

export function HeadphonesRecommendationWarning({
  enabled = true,
  checkInterval = 5000,
}: HeadphonesRecommendationWarningProps) {
  const [isSpeakerActive, setIsSpeakerActive] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)

  useEffect(() => {
    if (!enabled) return

    const check = async () => {
      try {
        const info = await invoke<AudioOutputInfo>('get_active_audio_output')
        const usingSpeaker = info.device_type === 'Speaker'
        setIsSpeakerActive(usingSpeaker)
        if (!usingSpeaker) {
          setIsDismissed(false) // reset when headphones are connected
        }
      } catch {
        setIsSpeakerActive(false)
      }
    }

    check()
    const interval = setInterval(check, checkInterval)
    return () => clearInterval(interval)
  }, [enabled, checkInterval])

  if (!enabled || !isSpeakerActive || isDismissed) return null

  return (
    <div className="mb-3 mx-auto w-2/3 max-w-[750px] min-w-[200px] flex justify-center">
      <div className="bg-white dark:bg-gray-900 border border-yellow-500/30 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.3)] px-5 py-3 flex items-center gap-3 w-full">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-yellow-500/10 flex items-center justify-center">
          <Headphones className="w-4 h-4 text-yellow-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-900 dark:text-gray-100">
            Se recomiendan audífonos
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Con bocinas, el micrófono puede captar el audio del sistema y duplicar la transcripción.
          </p>
        </div>
        <button
          onClick={() => setIsDismissed(true)}
          className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition-colors"
          aria-label="Descartar advertencia"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
