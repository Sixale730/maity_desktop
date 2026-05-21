'use client'

import { Bot } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../types'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#485df4]/10 flex items-center justify-center mt-0.5">
          <Bot className="w-4 h-4 text-[#485df4]" />
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary/10 text-foreground rounded-tr-sm whitespace-pre-wrap'
            : 'bg-secondary text-foreground rounded-tl-sm prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1'
        }`}
      >
        {isUser ? (
          message.content
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        )}
      </div>
    </div>
  )
}

export function AssistantTypingBubble() {
  return (
    <div className="flex gap-2 justify-start">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#485df4]/10 flex items-center justify-center mt-0.5">
        <Bot className="w-4 h-4 text-[#485df4]" />
      </div>
      <div className="bg-secondary rounded-2xl rounded-tl-sm px-4 py-2.5">
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" />
        </div>
      </div>
    </div>
  )
}
