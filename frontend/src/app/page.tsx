'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { RecordingControls } from '@/components/recording/RecordingControls';
import { LiveFeedbackPanel } from '@/components/coach/LiveFeedbackPanel';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { StatusOverlays } from '@/app/_components/StatusOverlays';
import Analytics from '@/lib/analytics';
import { SettingsModals } from './_components/SettingsModal';
import { TranscriptPanel } from './_components/TranscriptPanel';
import { useModalState } from '@/hooks/useModalState';
import { useRecordingStart } from '@/hooks/useRecordingStart';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import { useTranscriptRecovery } from '@/hooks/useTranscriptRecovery';
import { TranscriptRecovery } from '@/components/transcript/TranscriptRecovery';
import { indexedDBService } from '@/services/indexedDBService';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { useParakeetAutoDownloadContext } from '@/contexts/ParakeetAutoDownloadContext';
import { useRecordingLevels } from '@/hooks/useRecordingLevels';
import { usePreviewLevels } from '@/hooks/usePreviewLevels';
import { GamifiedDashboardV2 } from '@/features/gamification'
import { HeadphonesRecommendationWarning } from '@/components/recording/HeadphonesRecommendationWarning';

export default function Home() {
  // Local page state
  const [barHeights] = useState(['58%', '76%', '58%']); // Legacy fallback
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [isRecordingDisabled, setIsRecordingDisabled] = useState(false);

  // Use contexts for state management
  const { meetingTitle } = useTranscripts();
  const { transcriptModelConfig, selectedDevices, setSelectedDevices } = useConfig();
  const recordingState = useRecordingState();

  // Extract status from global state — single source of truth
  const { status, isStopping, isProcessing, isRecording } = recordingState;

  // Hooks
  const { isModelReady: isParakeetModelReady, isDownloading: isParakeetDownloading } = useParakeetAutoDownloadContext();
  const { hasMicrophone, checkPermissions, isChecking: isCheckingPermissions } = usePermissionCheck();
  const { isCollapsed: sidebarCollapsed, refetchMeetings } = useSidebar();
  const { modals, messages, showModal, hideModal } = useModalState(transcriptModelConfig);
  const { handleRecordingStart } = useRecordingStart(isRecording, (_v) => { /* no-op: RecordingStateContext is source of truth */ }, showModal);

  // Get handleRecordingStop function and setIsStopping (state comes from global context)
  const { handleRecordingStop, setIsStopping } = useRecordingStop(
    setIsRecordingDisabled
  );

  // Recovery hook
  const {
    recoverableMeetings,
    isLoading: _isLoadingRecovery,
    isRecovering: _isRecovering,
    checkForRecoverableTranscripts,
    recoverMeeting,
    loadMeetingTranscripts,
    deleteRecoverableMeeting
  } = useTranscriptRecovery();

  const router = useRouter();

  useEffect(() => {
    // Track page view
    Analytics.trackPageView('home');
  }, []);

  // Startup recovery check — runs once on mount only
  useEffect(() => {
    const performStartupChecks = async () => {
      try {
        // 1. Clean up old meetings (7+ days)
        try {
          await indexedDBService.deleteOldMeetings(7);
        } catch (error) {
          console.warn('Failed to clean up old meetings:', error);
        }

        // 2. Clean up saved meetings (24+ hours after save)
        try {
          await indexedDBService.deleteSavedMeetings(24);
        } catch (error) {
          console.warn('Failed to clean up saved meetings:', error);
        }

        // 3. Check for recoverable meetings on startup
        await checkForRecoverableTranscripts();
      } catch (error) {
        console.error('Failed to perform startup checks:', error);
      }
    };

    performStartupChecks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch for recoverable meetings changes and show dialog once per session
  useEffect(() => {
    if (recoverableMeetings.length > 0) {
      const shownThisSession = sessionStorage.getItem('recovery_dialog_shown');
      if (!shownThisSession) {
        setShowRecoveryDialog(true);
        sessionStorage.setItem('recovery_dialog_shown', 'true');
      }
    }
  }, [recoverableMeetings]);

  // Handle recovery with toast notifications and navigation
  const handleRecovery = async (meetingId: string) => {
    try {
      const result = await recoverMeeting(meetingId);

      if (result.success) {
        toast.success('Reunion recuperada exitosamente!', {
          description: result.audioRecoveryStatus?.status === 'success'
            ? 'Transcripciones y audio recuperados'
            : 'Transcripciones recuperadas (sin audio disponible)',
          action: result.meetingId ? {
            label: 'Ver Reunion',
            onClick: () => {
              router.push(`/conversations?localId=${result.meetingId}&source=local`);
            }
          } : undefined,
          duration: 10000,
        });

        // Refresh sidebar to show the newly recovered meeting
        await refetchMeetings();

        if (recoverableMeetings.length === 0) {
          sessionStorage.removeItem('recovery_dialog_shown');
        }

        // Auto-navigate after a short delay
        if (result.meetingId) {
          setTimeout(() => {
            router.push(`/conversations?localId=${result.meetingId}&source=local`);
          }, 2000);
        }
      }
    } catch (error) {
      toast.error('Error al recuperar reunion', {
        description: error instanceof Error ? error.message : 'Ocurrio un error desconocido',
      });
      throw error;
    }
  };

  // Handle dialog close
  const handleDialogClose = () => {
    setShowRecoveryDialog(false);
    if (recoverableMeetings.length === 0) {
      sessionStorage.removeItem('recovery_dialog_shown');
    }
  };

  // Audio levels: preview (CPAL monitor) when idle, pipeline levels when recording
  const recordingLevels = useRecordingLevels(isRecording);
  const previewLevels = usePreviewLevels(isRecording, selectedDevices.micDevice);
  const audioLevels = isRecording ? recordingLevels : previewLevels;

  // Computed values using global status
  const isProcessingStop = status === RecordingStatus.PROCESSING_TRANSCRIPTS || isProcessing;

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col h-screen bg-background"
    >
      {/* All Modals supported*/}
      <SettingsModals
        modals={modals}
        messages={messages}
        onClose={hideModal}
      />

      {/* Recovery Dialog */}
      <TranscriptRecovery
        isOpen={showRecoveryDialog}
        onClose={handleDialogClose}
        recoverableMeetings={recoverableMeetings}
        onRecover={handleRecovery}
        onDelete={deleteRecoverableMeeting}
        onLoadPreview={loadMeetingTranscripts}
      />
      <div className="flex flex-1 overflow-hidden">
        {isRecording || isProcessingStop || isStopping ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            {isRecording && (
              <div className="px-4 pt-3">
                <LiveFeedbackPanel />
              </div>
            )}
            <TranscriptPanel
              isProcessingStop={isProcessingStop}
              isStopping={isStopping}
              showModal={showModal}
            />
          </div>
        ) : (
          <div className="w-full overflow-y-auto">
            <GamifiedDashboardV2 />
          </div>
        )}

        {/* Status Overlays - Processing and Saving */}
        <StatusOverlays
          isProcessing={status === RecordingStatus.PROCESSING_TRANSCRIPTS && !isRecording}
          isSaving={status === RecordingStatus.SAVING}
          sidebarCollapsed={sidebarCollapsed}
        />
      </div>
    </motion.div>

    {/* Recording controls - OUTSIDE motion.div to escape stacking context */}
    {(hasMicrophone || isRecording) &&
      status !== RecordingStatus.PROCESSING_TRANSCRIPTS &&
      status !== RecordingStatus.SAVING && (
        <div className="fixed bottom-0 left-0 right-0 z-50 pb-12 pt-4 bg-gradient-to-t from-[#0a0a1a] via-[#0a0a1a]/95 to-transparent">
          <div
            className="flex flex-col items-center pl-8 transition-[margin] duration-300"
            style={{
              marginLeft: sidebarCollapsed ? '4rem' : '16rem'
            }}
          >
            <HeadphonesRecommendationWarning enabled={hasMicrophone && !isRecording} />
            <div className="w-2/3 max-w-[750px] min-w-[200px] flex justify-center">
              <div className="bg-white dark:bg-gray-900 rounded-full shadow-lg flex items-center overflow-visible">
                <RecordingControls
                  isRecording={isRecording}
                  onRecordingStop={(callApi = true) => handleRecordingStop(callApi)}
                  onRecordingStart={handleRecordingStart}
                  onTranscriptReceived={() => { }}
                  onStopInitiated={() => setIsStopping(true)}
                  barHeights={barHeights}
                  audioLevels={audioLevels}
                  onTranscriptionError={(message) => {
                    showModal('errorAlert', message);
                  }}
                  isRecordingDisabled={isRecordingDisabled || (isParakeetDownloading && !isParakeetModelReady)}
                  isParentProcessing={isProcessingStop}
                  selectedDevices={selectedDevices}
                  meetingName={meetingTitle}
                  onDeviceSwitched={(deviceName, deviceType) => {
                    setSelectedDevices({
                      ...selectedDevices,
                      ...(deviceType === 'Microphone'
                        ? { micDevice: deviceName }
                        : { systemDevice: deviceName }),
                    });
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

    {/* No microphone detected banner - OUTSIDE motion.div to escape stacking context */}
    {!hasMicrophone && !isRecording && !isCheckingPermissions &&
      status !== RecordingStatus.PROCESSING_TRANSCRIPTS &&
      status !== RecordingStatus.SAVING && (
        <div className="fixed bottom-0 left-0 right-0 z-50 pb-12 pt-4 bg-gradient-to-t from-[#0a0a1a] via-[#0a0a1a]/95 to-transparent">
          <div
            className="flex justify-center pl-8 transition-[margin] duration-300"
            style={{
              marginLeft: sidebarCollapsed ? '4rem' : '16rem'
            }}
          >
            <div className="bg-white dark:bg-gray-900 border border-yellow-500/30 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.3)] px-6 py-4 flex items-center gap-4 max-w-[500px]">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-yellow-500/10 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-yellow-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  No se detectó micrófono
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Conecta un micrófono externo (USB o Bluetooth) para grabar
                </p>
              </div>
              <button
                onClick={() => checkPermissions()}
                className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20 rounded-lg transition-colors"
              >
                Reintentar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
