'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConversationsList, ConversationDetail, OmiConversation, getOmiConversation, getLocalMeetingDetail } from '@/features/conversations';

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
