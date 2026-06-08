import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell, CombinedSidebar } from '@/shared/components/shell-v5';
import { MaityLogo } from '@/shared/components/MaityLogo';
import { useUser } from '@/contexts/UserContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { ActiveEntryItem } from './ActiveEntryItem';
import { ChatConversation } from './ChatConversation';
import { ChatEmpty } from './ChatEmpty';
import { ChatTopBar } from './ChatTopBar';
import { Composer, type ComposerAttachment } from './Composer';
import { MemoriesOverlay } from './MemoriesOverlay';
import {
  useCreateThread,
  useThreads,
} from '../hooks/useThreads';
import { useMessages, useSendMessage } from '../hooks/useMessages';
import {
  useAddManualMemory,
  useApproveMemory,
  useChatSettings,
  useMemories,
  useRejectMemory,
  useSetMemoryExtractionPaused,
  useUpdateMemoryContent,
} from '../hooks/useMemories';
import { useThreadLens } from '../hooks/useThreadLens';
import type { EntryType, Lens } from '../types';

/**
 * Top-level /chat screen on Shell v5 (desktop minimal variant).
 *
 * Two main visual states:
 *   - empty: no active thread, OR active thread has zero messages → hero +
 *     4 starter cards + open-loop banner
 *   - active: active thread with messages → ChatConversation rendering each
 *     turn with ChatTurn primitives
 *
 * Sidebar minimal: brand + Nueva sesión + lista de conversaciones + footer.
 * Sin ActivityRail, sin ZoneSwitcher, sin calendario, sin urgency legend.
 *
 * Keyboard:
 *   - ⌘N → new session
 */
export function MaityChatLayout() {
  const { userProfile } = useUser();
  const { t } = useLanguage();
  const userId = userProfile?.id;

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  // Lente elegida en el composer antes de que exista un thread (creación lazy).
  // Cuando el thread nace en el primer envío la persistimos; hasta entonces es local.
  const [pendingLens, setPendingLens] = useState<Lens>('open');
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const threadsQuery = useThreads(userId);
  const messagesQuery = useMessages(activeThreadId ?? undefined);
  const sendMessage = useSendMessage(userId);
  const createThread = useCreateThread(userId);
  const updateLens = useThreadLens(userId);

  const memoriesQuery = useMemories(userId);
  const settingsQuery = useChatSettings(userId);
  const approveMemory = useApproveMemory(userId);
  const rejectMemory = useRejectMemory(userId);
  const updateMemory = useUpdateMemoryContent(userId);
  const addMemory = useAddManualMemory(userId);
  const setPaused = useSetMemoryExtractionPaused(userId);

  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data]);
  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const memories = useMemo(() => memoriesQuery.data ?? [], [memoriesQuery.data]);
  const approvedMemories = useMemo(
    () => memories.filter((m) => m.status === 'approved'),
    [memories],
  );
  const activeThread = useMemo(
    () => threads.find((th) => th.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  const isEmpty = !activeThread || messages.length === 0;

  const openThreads = useMemo(() => threads.filter((th) => th.open === true), [threads]);

  const handleNewSession = useCallback(() => {
    // Lazy: no persistimos un thread aquí — eso es lo que dejaba filas vacías
    // "Nueva conversación" en la DB. Solo reseteamos al estado vacío; el thread
    // se crea en el primer envío (handleSend lo crea cuando no hay ninguno).
    setActiveThreadId(null);
    setInput('');
    setAttachments([]);
    setPendingLens('open');
    composerRef.current?.focus();
  }, []);

  const handleContinueOpen = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
  }, []);

  const handleSelectThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    setAttachments([]); // los adjuntos son por-turno; no migran entre threads
  }, []);

  const handleSend = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sendMessage.isPending || !userId) return;

    let thread = activeThread;
    if (!thread) {
      thread = await createThread.mutateAsync();
      // Llevamos la lente elegida antes de que existiera el thread al nuevo
      // thread, y la persistimos para que sobreviva un reload. Override local
      // primero para que este envío ya la use (sendMessage lee thread.lens).
      if (pendingLens !== 'open') {
        thread = { ...thread, lens: pendingLens };
        updateLens.mutate({ threadId: thread.id, lens: pendingLens });
      }
      setActiveThreadId(thread.id);
      setPendingLens('open');
    }

    const turnAttachments = attachments;
    setInput('');
    setAttachments([]);
    await sendMessage.mutateAsync({
      thread,
      content,
      history: messages,
      approvedMemories,
      attachments: turnAttachments.length > 0 ? turnAttachments : undefined,
    });
  }, [activeThread, approvedMemories, attachments, createThread, input, messages, pendingLens, sendMessage, updateLens, userId]);

  const handlePickStarter = useCallback(
    async (seedText: string, entryType: EntryType, chip?: string) => {
      type StarterEntryType = 'thinking' | 'decision' | 'rehearsal' | 'reflection';
      const messageOpen: Record<StarterEntryType, string> = {
        thinking: t('chat.starter_thinking_message_open'),
        decision: t('chat.starter_decision_message_open'),
        rehearsal: t('chat.starter_rehearsal_message_open'),
        reflection: t('chat.starter_reflection_message_open'),
      };
      const fallback = messageOpen[entryType as StarterEntryType] ?? '';
      const text = chip ? `${seedText}${chip}.` : fallback;
      if (text) await handleSend(text);
    },
    [handleSend, t],
  );

  const handleLensChange = useCallback((lens: Lens) => {
    // Aún no hay thread (lazy): guardamos la elección localmente hasta el primer envío.
    if (!activeThreadId) {
      setPendingLens(lens);
      return;
    }
    updateLens.mutate({ threadId: activeThreadId, lens });
  }, [activeThreadId, updateLens]);

  // ⌘N shortcut — new session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
        e.preventDefault();
        void handleNewSession();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleNewSession]);

  // Defensive refetch — si `userId` aparece tarde (race condition al boot
  // entre AuthContext y React Query), forzamos refetch de threads. Si la
  // primera invocación de `useThreads(undefined)` cacheó `[]`, sin esto el
  // sidebar quedaría vacío hasta que pase `staleTime` (30s).
  useEffect(() => {
    if (userId) {
      void threadsQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!userId) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <div className="max-w-sm text-center p-6">
          <div className="mx-auto w-12 h-12 rounded-xl bg-maity-blue/10 flex items-center justify-center mb-3">
            <MaityLogo variant="symbol" size="md" className="!min-w-0" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-1">{t('chat.title')}</h2>
          <p className="text-sm text-foreground/60">{t('chat.login_required')}</p>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      topBar={
        <ChatTopBar
          thread={activeThread}
          messageCount={messages.length}
          memoriesCount={approvedMemories.length}
          onOpenMemories={() => setMemoriesOpen(true)}
        />
      }
      sidebar={
        <CombinedSidebar
          onNewSession={handleNewSession}
          isCreating={createThread.isPending}
          todayEntriesSlot={
            <div
              className="border border-border"
              style={{
                margin: '8px 12px 12px',
                padding: 12,
                borderRadius: 10,
                background: 'hsl(var(--card))',
              }}
            >
              <div
                className="text-foreground/40 uppercase font-semibold mb-2"
                style={{ fontSize: 10, letterSpacing: '0.5px' }}
              >
                {t('chat.my_conversations')}
              </div>
              {threads.length === 0 ? (
                <div
                  className="text-foreground/40 py-2"
                  style={{ fontSize: 11 }}
                >
                  {t('chat.no_conversations')}
                </div>
              ) : (
                threads.map((th) => (
                  <ActiveEntryItem
                    key={th.id}
                    thread={th}
                    active={th.id === activeThreadId}
                    onClick={() => handleSelectThread(th.id)}
                  />
                ))
              )}
            </div>
          }
        />
      }
    >
      {isEmpty ? (
        <ChatEmpty
          onPickStarter={handlePickStarter}
          openThreads={openThreads}
          onContinueOpen={handleContinueOpen}
        />
      ) : (
        <ChatConversation
          messages={messages}
          isLoading={messagesQuery.isLoading}
          isSending={sendMessage.isPending}
          userFirstName={userProfile?.first_name}
          onSuggestionClick={(text) => handleSend(text)}
          onCtaClick={(preFill) => handleSend(preFill)}
        />
      )}

      <Composer
        ref={composerRef}
        value={input}
        onChange={setInput}
        onSend={() => handleSend()}
        disabled={sendMessage.isPending}
        isSending={sendMessage.isPending}
        lens={activeThread?.lens ?? pendingLens}
        onLensChange={handleLensChange}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
      />

      <MemoriesOverlay
        open={memoriesOpen}
        onOpenChange={setMemoriesOpen}
        memories={memories}
        settings={settingsQuery.data}
        isLoading={memoriesQuery.isLoading}
        onApprove={(id) => approveMemory.mutate(id)}
        onReject={(id) => rejectMemory.mutate(id)}
        onUpdate={(id, content) => updateMemory.mutate({ memoryId: id, content })}
        onAddManual={(content) => addMemory.mutate(content)}
        onTogglePaused={(paused) => setPaused.mutate(paused)}
      />
    </AppShell>
  );
}
