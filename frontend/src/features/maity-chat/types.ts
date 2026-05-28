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
