'use client'

import { useEffect, useRef } from 'react'
import { Bot } from 'lucide-react'
import { AssistantTypingBubble, MessageBubble } from './MessageBubble'
import type { ChatMessage } from '../types'

interface ChatThreadViewProps {
  messages: ChatMessage[]
  isLoading?: boolean
  isSending?: boolean
  onSuggestionClick?: (text: string) => void
}

const SUGGESTIONS = [
  '¿Cómo puedo ser más asertivo en mis 1:1 con mi equipo?',
  'Ayúdame a estructurar mi semana para tener foco real.',
  '¿Qué muletillas debería trabajar para sonar más claro?',
  'Dame 3 frases para abrir una conversación difícil con empatía.',
]

export function ChatThreadView({
  messages,
  isLoading,
  isSending,
  onSuggestionClick,
}: ChatThreadViewProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isSending])

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Cargando mensajes...
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-6 pb-2">
        <div className="flex flex-col items-center justify-center h-full gap-6 text-center max-w-md mx-auto">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-[#485df4]/10">
            <Bot className="h-8 w-8 text-[#485df4]" />
          </div>
          <div>
            <p className="text-foreground font-medium mb-1">Hola, soy Maity</p>
            <p className="text-sm text-muted-foreground">
              Soy tu coach personal de habilidades blandas y productividad. Pregúntame lo que
              quieras: comunicación, manejo de emociones, foco, prioridades, conversaciones
              difíciles.
            </p>
          </div>
          {onSuggestionClick && (
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSuggestionClick(s)}
                  className="text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:bg-secondary transition-colors text-foreground text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-2">
      <div className="space-y-4 py-2 max-w-3xl mx-auto">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isSending && <AssistantTypingBubble />}
        <div ref={endRef} />
      </div>
    </div>
  )
}
