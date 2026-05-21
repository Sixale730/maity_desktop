'use client'

import { KeyboardEvent, useRef } from 'react'
import { Loader2, Send } from 'lucide-react'

interface ComposerInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  disabled?: boolean
  isSending?: boolean
  placeholder?: string
}

export function ComposerInput({
  value,
  onChange,
  onSend,
  disabled,
  isSending,
  placeholder = 'Escribe tu pregunta... (Enter para enviar, Shift+Enter para nueva línea)',
}: ComposerInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!disabled && value.trim()) onSend()
    }
  }

  return (
    <div className="flex gap-2 items-end bg-background rounded-2xl border border-border p-2 shadow-sm">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={2}
        disabled={disabled}
        className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none px-2 py-1 disabled:opacity-50"
      />
      <button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#485df4] hover:bg-[#3a4fd4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
      >
        {isSending ? (
          <Loader2 className="w-4 h-4 text-white animate-spin" />
        ) : (
          <Send className="w-4 h-4 text-white" />
        )}
      </button>
    </div>
  )
}
