'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConversationsList, ConversationDetail, OmiConversation, getOmiConversation, getLocalMeetingDetail } from '@/features/conversations';
import { logPoll } from '@/lib/diagnostics';

function ConversationsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const idParam = searchParams.get('id');
  const localIdParam = searchParams.get('localId');
  const source = searchParams.get('source');

  const [selectedConversation, setSelectedConversation] = useState<OmiConversation | null>(null);
  const [isLoadingFromParam, setIsLoadingFromParam] = useState(!!idParam || !!localIdParam);

  // Mostrar toast post-recording que persiste a traves del hard navigate de
  // useRecordingStop. sessionStorage sobrevive a window.location.href en el
  // mismo origin, asi que el toast aparece tras el reload sin perderse.
  useEffect(() => {
    const raw = sessionStorage.getItem('post_recording_toast');
    if (!raw) return;
    sessionStorage.removeItem('post_recording_toast');
    try {
      const { count, ts } = JSON.parse(raw) as { count: number; ts: number };
      // Ignorar toasts viejos (>30s) — proteccion contra stale flags si el
      // usuario navega por su cuenta a /conversations sin venir de stop.
      if (Date.now() - ts > 30_000) return;
      toast.success('Grabación guardada exitosamente!', {
        description: `${count} segmentos de transcripción guardados.`,
        duration: 5000,
      });
    } catch {
      // payload corrupto, ignorar silenciosamente
    }
  }, []);

  // Load from Supabase ?id= param
  useEffect(() => {
    if (!idParam) return;
    setIsLoadingFromParam(true);

    const fetchWithRetry = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const conv = await getOmiConversation(idParam);
          if (conv) {
            setSelectedConversation(conv);
            return;
          }
          console.warn(`Conversation not found (attempt ${attempt + 1}):`, idParam);
        } catch (err) {
          console.warn(`Error loading conversation (attempt ${attempt + 1}):`, err);
        }
        if (attempt === 0) await new Promise(r => setTimeout(r, 2000));
      }
    };

    fetchWithRetry().finally(() => setIsLoadingFromParam(false));
  }, [idParam]);

  // Load from local SQLite ?localId= param
  useEffect(() => {
    if (!localIdParam) return;
    setIsLoadingFromParam(true);

    getLocalMeetingDetail(localIdParam)
      .then((conv) => {
        if (conv) {
          setSelectedConversation(conv);
        } else {
          console.warn('Local meeting not found:', localIdParam);
        }
      })
      .catch((err) => {
        console.warn('Error loading local meeting:', err);
      })
      .finally(() => setIsLoadingFromParam(false));
  }, [localIdParam]);

  // Auto-swap local→cloud cuando finalize completa.
  // Si la conv mostrada es local-only, useConversationLive esta apagado
  // (ConversationDetail.tsx:91 con !isLocalOnly), asi que el polling al
  // cloud nunca se entera de que el analisis llego. Resultado: usuario
  // ve "Analizando con Maity..." indefinidamente.
  //
  // Hibrido: listener del evento `sync-status-changed` (camino rapido
  // cuando el user esta en la pagina mientras finalize completa) +
  // polling cada 3s del Tauri command sync_queue_get_finalize_result
  // (fallback para cuando el user llega DESPUES de que el evento ya
  // disparo).
  //
  // Cuando detecta finalize completed, fetch de la conv cloud y swap:
  // setSelectedConversation con la version cloud → ConversationDetail
  // re-rendea con isLocalOnly=false → useConversationLive se enciende →
  // polling cloud arranca → analisis aparece.
  useEffect(() => {
    if (!selectedConversation) return;
    if (selectedConversation.source !== 'local') return;
    const meetingId = selectedConversation.id;
    let cancelled = false;

    const swapToCloud = async (cloudId: string) => {
      if (cancelled) return;
      logPoll('local_to_cloud_swap_start', { meetingId, cloudId });
      try {
        const cloudConv = await getOmiConversation(cloudId);
        if (cancelled || !cloudConv) return;
        logPoll('local_to_cloud_swap_ok', {
          meetingId,
          cloudId,
          hasV4: !!cloudConv.communication_feedback_v4,
          hasMinuta: !!cloudConv.meeting_minutes_data,
        });
        setSelectedConversation(cloudConv);
        // Actualizar URL: ?localId=X → ?id=cloudId. router.replace evita
        // ensuciar el historial del browser con la version intermedia.
        router.replace(`/conversations?id=${cloudId}`);
      } catch (err) {
        logPoll('local_to_cloud_swap_error', {
          meetingId,
          cloudId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const checkSyncQueue = async () => {
      if (cancelled) return;
      try {
        const raw = await invoke<string | null>('sync_queue_get_finalize_result', { meetingId });
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as { ok?: boolean; conversation_id?: string };
        if (parsed.ok && parsed.conversation_id) {
          await swapToCloud(parsed.conversation_id);
        }
      } catch {
        // sync_queue todavia no listo o parse error — silencioso, proximo tick.
      }
    };

    // Camino rapido: listener del evento del worker.
    const onSyncStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail as { meetingId?: string; jobType?: string; status?: string };
      if (detail?.meetingId !== meetingId) return;
      if (detail?.jobType !== 'finalize_conversation') return;
      if (detail?.status !== 'completed') return;
      void checkSyncQueue();
    };
    window.addEventListener('sync-status-changed', onSyncStatus);

    // Camino fallback: polling cada 3s.
    void checkSyncQueue(); // primer check inmediato
    const interval = setInterval(checkSyncQueue, 3000);

    return () => {
      cancelled = true;
      window.removeEventListener('sync-status-changed', onSyncStatus);
      clearInterval(interval);
    };
  }, [selectedConversation?.id, selectedConversation?.source, router]);

  const handleClose = () => {
    setSelectedConversation(null);
    if (idParam || localIdParam) {
      router.replace('/conversations');
    }
  };

  const handleConversationUpdate = (updated: OmiConversation) => {
    setSelectedConversation(updated);
  };

  if (isLoadingFromParam) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin mb-3" />
          <p className="text-sm text-muted-foreground">Cargando conversación...</p>
        </div>
      </div>
    );
  }

  if (selectedConversation) {
    // The `isAnalyzing` hint is only relevant for local-only conversations (the row may
    // not yet exist in Supabase). For cloud rows, ConversationDetail derives the phase
    // from the live Postgres data via useConversationLive.
    const isAnalyzing =
      source === 'recording' &&
      (!selectedConversation.communication_feedback_v4 || !selectedConversation.meeting_minutes_data);
    return (
      <div className="h-full flex flex-col bg-background">
        <ConversationDetail
          conversation={selectedConversation}
          onClose={handleClose}
          onConversationUpdate={handleConversationUpdate}
          isAnalyzing={isAnalyzing}
        />
      </div>
    );
  }

  return (
    <div className="h-full bg-muted">
      <ConversationsList
        onSelect={setSelectedConversation}
        selectedId={null}
      />
    </div>
  );
}

export default function ConversationsPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
        </div>
      }
    >
      <ConversationsContent />
    </Suspense>
  );
}
