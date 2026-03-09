'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { RecordingControls } from '@/components/recording/RecordingControls';
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
import { GamifiedDashboardV2 } from '@/features/gamification';

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
  const { status, isStopping, isProcessing, isSaving, isRecording } = recordingState;

  // Hooks
  const { isModelReady: isParakeetModelReady, isDownloading: isParakeetDownloading } = useParakeetAutoDownloadContext();
  const { hasMicrophone } = usePermissionCheck();
  const { setIsMeetingActive, isCollapsed: sidebarCollapsed, refetchMeetings } = useSidebar();
  const { modals, messages, showModal, hideModal } = useModalState(transcriptModelConfig);
  const { handleRecordingStart } = useRecordingStart(isRecording, (v) => { /* no-op: RecordingStateContext is source of truth */ }, showModal);

  // Get handleRecordingStop function and setIsStopping (state comes from global context)
  const { handleRecordingStop, setIsStopping } = useRecordingStop(
    setIsRecordingDisabled
  );

  // Recovery hook
  const {
    recoverableMeetings,
    isLoading: isLoadingRecovery,
    isRecovering,
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

  // Startup recovery check
  useEffect(() => {
    const performStartupChecks = async () => {
      try {
        // Skip recovery check if currently recording or processing stop
        if (isRecording ||
          status === RecordingStatus.STOPPING ||
          status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
          status === RecordingStatus.SAVING) {
          console.log('Skipping recovery check - recording in progress or processing');
          return;
        }

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

        // 3. Always check for recoverable meetings on startup
        await checkForRecoverableTranscripts();
      } catch (error) {
        console.error('Failed to perform startup checks:', error);
      }
    };

    performStartupChecks();
  }, [checkForRecoverableTranscripts, isRecording, status]);

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
          <TranscriptPanel
            isProcessingStop={isProcessingStop}
            isStopping={isStopping}
            showModal={showModal}
          />
        ) : (
          <div className="w-full overflow-y-auto">
            <GamifiedDashboardV2 />
          </div>
        )}

        {/* Recording controls - only show when permissions are granted or already recording and not showing status messages */}
        {(hasMicrophone || isRecording) &&
          status !== RecordingStatus.PROCESSING_TRANSCRIPTS &&
          status !== RecordingStatus.SAVING && (
            <div className="fixed bottom-12 left-0 right-0 z-10">
              <div
                className="flex justify-center pl-8 transition-[margin] duration-300"
                style={{
                  marginLeft: sidebarCollapsed ? '4rem' : '16rem'
                }}
              >
                <div className="w-2/3 max-w-[750px] flex justify-center">
                  <div className="bg-card rounded-full shadow-lg flex items-center">
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

        {/* Status Overlays - Processing and Saving */}
        <StatusOverlays
          isProcessing={status === RecordingStatus.PROCESSING_TRANSCRIPTS && !isRecording}
          isSaving={status === RecordingStatus.SAVING}
          sidebarCollapsed={sidebarCollapsed}
        />
      </div>
    </motion.div>
  );
}
