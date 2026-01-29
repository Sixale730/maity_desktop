'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Video, Mic, X, Clock, Settings } from 'lucide-react'
import { toast } from 'sonner'

interface DetectedMeeting {
  app: string | { Unknown: string }
  pid: number
  process_name: string
  window_title: string | null
  suggested_name: string
  detected_at: number
}

interface MeetingDetectedEvent {
  meeting: DetectedMeeting
  action: string // "ask", "auto_record", "ignored"
}

// Helper to get app display name
function getAppDisplayName(app: string | { Unknown: string }): string {
  if (typeof app === 'string') {
    switch (app) {
      case 'Zoom': return 'Zoom'
      case 'MicrosoftTeams': return 'Microsoft Teams'
      case 'GoogleMeet': return 'Google Meet'
      case 'Webex': return 'Webex'
      case 'Slack': return 'Slack'
      case 'Discord': return 'Discord'
      case 'Skype': return 'Skype'
      default: return app
    }
  }
  return app.Unknown || 'Aplicación desconocida'
}

// Helper to get app icon
function getAppIcon(app: string | { Unknown: string }): string {
  const appName = typeof app === 'string' ? app : 'Unknown'
  switch (appName) {
    case 'Zoom': return '/icons/zoom.svg'
    case 'MicrosoftTeams': return '/icons/teams.svg'
    case 'GoogleMeet': return '/icons/meet.svg'
    default: return '/icons/meeting.svg'
  }
}

export function MeetingDetectionDialog() {
  const [isOpen, setIsOpen] = useState(false)
  const [currentMeeting, setCurrentMeeting] = useState<DetectedMeeting | null>(null)
  const [meetingName, setMeetingName] = useState('')
  const [rememberChoice, setRememberChoice] = useState(false)
  const [autoRecordCountdown, setAutoRecordCountdown] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Listen for meeting detection events
  useEffect(() => {
    let unlisten: UnlistenFn | undefined

    const setupListener = async () => {
      unlisten = await listen<MeetingDetectedEvent>('meeting-detected', (event) => {
        const { meeting, action } = event.payload
        console.log('[MeetingDetection] Detected:', meeting, 'Action:', action)

        if (action === 'ask') {
          // Show dialog for user to decide
          setCurrentMeeting(meeting)
          setMeetingName(meeting.suggested_name)
          setIsOpen(true)
          setAutoRecordCountdown(null)
        } else if (action === 'auto_record') {
          // Start countdown for auto-recording
          setCurrentMeeting(meeting)
          setMeetingName(meeting.suggested_name)
          setIsOpen(true)
          setAutoRecordCountdown(5) // 5 second countdown
        }
      })
    }

    setupListener()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [])

  // Handle auto-record countdown
  useEffect(() => {
    if (autoRecordCountdown === null || autoRecordCountdown <= 0) return

    const timer = setTimeout(() => {
      if (autoRecordCountdown === 1) {
        // Start recording automatically
        handleStartRecording()
      } else {
        setAutoRecordCountdown(autoRecordCountdown - 1)
      }
    }, 1000)

    return () => clearTimeout(timer)
  }, [autoRecordCountdown])

  const handleStartRecording = useCallback(async () => {
    if (!currentMeeting) return

    setIsLoading(true)
    try {
      // Respond to the detection
      await invoke('respond_to_meeting_detection', {
        pid: currentMeeting.pid,
        action: rememberChoice ? 'auto_record_always' : 'start_recording',
        meetingName: meetingName,
      })

      setIsOpen(false)
      setCurrentMeeting(null)
      setAutoRecordCountdown(null)
    } catch (error) {
      console.error('[MeetingDetection] Failed to start recording:', error)
      toast.error('Error al iniciar grabación', {
        description: error instanceof Error ? error.message : String(error),
        duration: 5000,
      })
      // Keep dialog open so user can retry
    } finally {
      setIsLoading(false)
    }
  }, [currentMeeting, meetingName, rememberChoice])

  const handleIgnore = useCallback(async () => {
    if (!currentMeeting) return

    setIsLoading(true)
    try {
      await invoke('respond_to_meeting_detection', {
        pid: currentMeeting.pid,
        action: rememberChoice ? 'ignore_always' : 'ignore',
        meetingName: null,
      })

      setIsOpen(false)
      setCurrentMeeting(null)
      setAutoRecordCountdown(null)
    } catch (error) {
      console.error('[MeetingDetection] Failed to ignore meeting:', error)
      toast.error('Error al ignorar reunión', {
        description: error instanceof Error ? error.message : String(error),
        duration: 5000,
      })
    } finally {
      setIsLoading(false)
    }
  }, [currentMeeting, rememberChoice])

  const handleCancel = useCallback(() => {
    setIsOpen(false)
    setCurrentMeeting(null)
    setAutoRecordCountdown(null)
    setRememberChoice(false)
  }, [])

  if (!currentMeeting) return null

  const appName = getAppDisplayName(currentMeeting.app)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-5 w-5 text-blue-500" />
            Reunión detectada
          </DialogTitle>
          <DialogDescription>
            Se ha detectado que <strong>{appName}</strong> está activo.
            ¿Deseas iniciar la grabación?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Meeting name input */}
          <div className="space-y-2">
            <label htmlFor="meeting-name" className="text-sm font-medium">
              Nombre de la reunión
            </label>
            <Input
              id="meeting-name"
              value={meetingName}
              onChange={(e) => setMeetingName(e.target.value)}
              placeholder="Ej: Standup diario"
              disabled={isLoading}
            />
          </div>

          {/* Remember choice toggle */}
          <div className="flex items-center justify-between">
            <label
              htmlFor="remember-choice"
              className="text-sm text-gray-600 dark:text-gray-400 cursor-pointer"
            >
              Recordar mi elección para {appName}
            </label>
            <Switch
              id="remember-choice"
              checked={rememberChoice}
              onCheckedChange={setRememberChoice}
              disabled={isLoading}
            />
          </div>

          {/* Auto-record countdown */}
          {autoRecordCountdown !== null && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
              <Clock className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-blue-700 dark:text-blue-300">
                Grabación automática en {autoRecordCountdown} segundos...
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAutoRecordCountdown(null)}
                className="ml-auto"
              >
                Cancelar
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleIgnore}
            disabled={isLoading}
          >
            <X className="h-4 w-4 mr-2" />
            Ignorar
          </Button>
          <Button
            onClick={handleStartRecording}
            disabled={isLoading || !meetingName.trim()}
          >
            <Mic className="h-4 w-4 mr-2" />
            {isLoading ? 'Iniciando...' : 'Iniciar grabación'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default MeetingDetectionDialog
