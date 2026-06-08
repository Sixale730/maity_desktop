import type { DeckSpec } from '@maity/shared';

export type ChatRole = 'user' | 'assistant';
export type MemoryStatus = 'proposed' | 'approved' | 'rejected';

export type Urgency = 'now' | 'week' | 'calm';
export type EntryType =
  | 'decision'
  | 'conversation'
  | 'focus'
  | 'reflection'
  | 'rehearsal'
  | 'thinking';
export type Lens = 'open' | 'ask' | 'mirror' | 'push' | 'sum';

export interface ChatThread {
  id: string;
  user_id: string;
  title: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  urgency?: Urgency;
  entry_type?: EntryType | null;
  open?: boolean;
  lens?: Lens;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  user_id: string;
  role: ChatRole;
  content: string;
  client_idempotency_key: string | null;
  created_at: string;
  /** Tasks created by tools on this (assistant) turn, hydrated from
   *  chat_tasks by `message_id`. Drives the inline confirmation pills.
   *  Undefined for messages predating tool-use (those still parse [[TASK:]]
   *  markers from `content` for backward-compat). */
  tasks?: Array<{ description: string; due?: string }>;
  /** Notes created by tools on this turn, hydrated from chat_notes. */
  notes?: Array<{ content: string }>;
  /** Documentos que el usuario adjuntó en este turno (de usuario), persistidos
   *  en la fila. Dibujan los chips read-only pegados al mensaje enviado (como
   *  Claude/ChatGPT). `text` es el contenido extraído (usado como contexto
   *  server-side); el chip solo renderiza `filename`. Null/undefined = ninguno. */
  attachments?: Array<{ filename: string; text?: string }> | null;
  /** Artifact estructurado producido por un tool (no en `content`). Puede ser un
   *  spec de presentación de `create_presentation` (→ tarjeta .pptx) o un spec de
   *  documento de `create_document` (→ tarjeta PDF). Forzar la salida vía tools
   *  evita que un lead-in conversacional del modelo bloquee el render (como pasaba
   *  con el marcador legacy `[[DOC:]]`). Persistido en `chat_messages.artifact` (jsonb). */
  artifact?:
    | { type: 'deck'; spec: DeckSpec }
    | { type: 'document'; spec: { title: string; content: string } }
    | null;
}

export interface ChatMemory {
  id: string;
  user_id: string;
  content: string;
  status: MemoryStatus;
  source_message_id: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface ChatSettings {
  user_id: string;
  memory_extraction_paused: boolean;
  updated_at: string;
}

export interface SendMessageResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  proposedMemories: string[];
  threadTitle?: string;
}
