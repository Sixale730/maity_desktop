'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { Bot, Send, Loader2, AlertTriangle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatReply {
  content: string;
  model: string;
  provider: string;
}

interface CoachStatus {
  available: boolean;
  chat_model: string;
  error?: string;
}

const EXAMPLE_CHIPS = [
  '¿Cuál fue mi conversación más reciente?',
  '¿En qué dimensión tengo más oportunidad de mejora?',
  '¿Cuáles son mis fortalezas de comunicación?',
  '¿Cuántas reuniones he tenido este mes?',
];

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [coachStatus, setCoachStatus] = useState<CoachStatus | null>(null);
  const [activeModel, setActiveModel] = useState<{ model: string; provider: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    invoke<CoachStatus>('coach_get_status')
      .then(s => setCoachStatus(s))
      .catch(() => setCoachStatus({ available: false, chat_model: '', error: 'No se pudo verificar el estado del modelo.' }));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isSending) return;

    const userMsg: ChatMsg = { role: 'user', content, timestamp: new Date() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsSending(true);

    try {
      const reply = await invoke<ChatReply>('coach_chat', {
        query: {
          messages: newMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        },
      });
      setActiveModel({ model: reply.model, provider: reply.provider });
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: reply.content, timestamp: new Date() },
      ]);
    } catch (err) {
      toast.error('No hay modelo disponible', { description: String(err) });
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const providerLabel = () => {
    if (!activeModel) return null;
    const isCoach = activeModel.provider === 'coach';
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${
          isCoach
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isCoach ? 'bg-emerald-500' : 'bg-blue-500'}`} />
        {isCoach ? 'Coach IA' : 'Built-In AI'} · {activeModel.model}
      </span>
    );
  };

  return (
    <div className="h-full flex flex-col bg-muted">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-[#485df4]/10">
              <Bot className="h-6 w-6 text-[#485df4]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Chat IA</h1>
              <p className="text-sm text-muted-foreground">Tu asistente de comunicación personal</p>
            </div>
          </div>
          {providerLabel()}
        </div>

        {/* Coach unavailable banner */}
        {coachStatus && !coachStatus.available && !activeModel && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  Coach IA no disponible
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {coachStatus.error ?? 'El motor LLM local no está activo.'}
                  {' '}El chat usará Built-In AI si hay un modelo descargado.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-6 pb-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center max-w-md mx-auto">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-[#485df4]/10">
              <Bot className="h-8 w-8 text-[#485df4]" />
            </div>
            <div>
              <p className="text-foreground font-medium mb-1">
                Hola, soy Maity
              </p>
              <p className="text-sm text-muted-foreground">
                Puedo analizar tus conversaciones y darte insights sobre tu comunicación. ¿En qué te ayudo?
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {EXAMPLE_CHIPS.map(chip => (
                <button
                  key={chip}
                  onClick={() => handleSend(chip)}
                  disabled={isSending}
                  className="text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:bg-secondary transition-colors text-foreground disabled:opacity-50"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#485df4]/10 flex items-center justify-center mt-0.5">
                    <Bot className="w-4 h-4 text-[#485df4]" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-primary/10 text-foreground rounded-tr-sm'
                      : 'bg-secondary text-foreground rounded-tl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isSending && (
              <div className="flex gap-2 justify-start">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#485df4]/10 flex items-center justify-center mt-0.5">
                  <Bot className="w-4 h-4 text-[#485df4]" />
                </div>
                <div className="bg-secondary rounded-2xl rounded-tl-sm px-4 py-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="px-6 pb-6 pt-2 flex-shrink-0">
        <div className="flex gap-2 items-end bg-background rounded-2xl border border-border p-2 shadow-sm">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu pregunta... (Enter para enviar, Shift+Enter para nueva línea)"
            rows={2}
            disabled={isSending}
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none px-2 py-1 disabled:opacity-50"
          />
          <button
            onClick={() => handleSend()}
            disabled={isSending || !input.trim()}
            className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#485df4] hover:bg-[#3a4fd4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            ) : (
              <Send className="w-4 h-4 text-white" />
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 text-center">
          El agente tiene acceso a todas tus conversaciones
        </p>
      </div>
    </div>
  );
}
