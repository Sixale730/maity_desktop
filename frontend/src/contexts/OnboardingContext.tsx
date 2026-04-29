'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { PermissionStatus, OnboardingPermissions } from '@/types/onboarding';
import { logger } from '@/lib/logger';

const PARAKEET_MODEL = 'parakeet-tdt-0.6b-v3-int8';

interface OnboardingStatus {
  version: string;
  completed: boolean;
  current_step: number;
  model_status: {
    parakeet: string;
    summary: string;
  };
  last_updated: string;
}

interface SummaryModelProgressInfo {
  percent: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
}

interface ParakeetProgressInfo {
  percent: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
}

interface OnboardingContextType {
  currentStep: number;
  completed: boolean;
  parakeetDownloaded: boolean;
  parakeetProgress: number;
  parakeetProgressInfo: ParakeetProgressInfo;
  summaryModelDownloaded: boolean;
  summaryModelProgress: number;
  summaryModelProgressInfo: SummaryModelProgressInfo;
  selectedSummaryModel: string;
  databaseExists: boolean;
  isBackgroundDownloading: boolean;
  // Cloud transcription (Deepgram) - skip local model downloads
  useCloudTranscription: boolean;
  // Permissions
  permissions: OnboardingPermissions;
  permissionsSkipped: boolean;
  // Navigation
  goToStep: (step: number) => void;
  goNext: () => void;
  goPrevious: () => void;
  // Setters
  setParakeetDownloaded: (value: boolean) => void;
  setSummaryModelDownloaded: (value: boolean) => void;
  setSelectedSummaryModel: (value: string) => void;
  setDatabaseExists: (value: boolean) => void;
  setUseCloudTranscription: (value: boolean) => void;
  setPermissionStatus: (permission: keyof OnboardingPermissions, status: PermissionStatus) => void;
  setPermissionsSkipped: (skipped: boolean) => void;
  completeOnboarding: () => Promise<void>;
  startBackgroundDownloads: (includeGemma: boolean) => Promise<void>;
  retryParakeetDownload: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);
  const [parakeetDownloaded, setParakeetDownloaded] = useState(false);
  const [parakeetProgress, setParakeetProgress] = useState(0);
  const [parakeetProgressInfo, setParakeetProgressInfo] = useState<ParakeetProgressInfo>({
    percent: 0,
    downloadedMb: 0,
    totalMb: 0,
    speedMbps: 0,
  });
  const [summaryModelDownloaded, setSummaryModelDownloaded] = useState(false);
  const [summaryModelProgress, setSummaryModelProgress] = useState(0);
  const [summaryModelProgressInfo, setSummaryModelProgressInfo] = useState<SummaryModelProgressInfo>({
    percent: 0,
    downloadedMb: 0,
    totalMb: 0,
    speedMbps: 0,
  });
  // §4.1 Default unico: gemma3:4b (antes default era 1b). 1b queda fuera del onboarding.
  const [selectedSummaryModel, setSelectedSummaryModel] = useState<string>('gemma3:4b');
  const [databaseExists, setDatabaseExists] = useState(false);
  const [isBackgroundDownloading, setIsBackgroundDownloading] = useState(false);

  // Cloud transcription state - when true, skip local model downloads
  const [useCloudTranscription, setUseCloudTranscription] = useState(false);

  // Permissions state
  const [permissions, setPermissions] = useState<OnboardingPermissions>({
    microphone: 'not_determined',
    systemAudio: 'not_determined',
    screenRecording: 'not_determined',
  });
  const [permissionsSkipped, setPermissionsSkipped] = useState(false);

  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  // Load status on mount and initialize database
  useEffect(() => {
    loadOnboardingStatus();
    checkDatabaseStatus();
    initializeDatabaseInBackground();

    // Fetch and set recommended model
    const fetchRecommendation = async () => {
      try {
        const recommendedModel = await invoke<string>('builtin_ai_get_recommended_model');
        setSelectedSummaryModel(recommendedModel);
        logger.debug('[OnboardingContext] Set recommended model:', recommendedModel);
      } catch (error) {
        console.error('[OnboardingContext] Failed to get recommended model:', error);
        // §4.1 Keep default gemma3:4b (1b ya no es opcion)
      }
    };
    fetchRecommendation();
  }, []);

  // Initialize database silently in background (moved from SetupOverviewStep)
  const initializeDatabaseInBackground = async () => {
    try {
      logger.debug('[OnboardingContext] Starting background database initialization');
      const isFirstLaunch = await invoke<boolean>('check_first_launch');

      if (!isFirstLaunch) {
        logger.debug('[OnboardingContext] Database exists, skipping initialization');
        setDatabaseExists(true);
        return;
      }

      // First launch - attempt auto-detection and import
      await performAutoDetection();
    } catch (error) {
      console.error('[OnboardingContext] Database initialization failed:', error);
      // Don't throw - database init failure shouldn't block onboarding
    }
  };

  const performAutoDetection = async () => {
    // Check Homebrew (macOS only)
    if (typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac')) {
      const homebrewDbPath = '/usr/local/var/maity/meeting_minutes.db';
      try {
        const homebrewCheck = await invoke<{ exists: boolean; size: number } | null>(
          'check_homebrew_database',
          { path: homebrewDbPath }
        );

        if (homebrewCheck?.exists) {
          logger.debug('[OnboardingContext] Found Homebrew database, importing');
          await invoke('import_and_initialize_database', { legacyDbPath: homebrewDbPath });
          setDatabaseExists(true);
          return;
        }
      } catch (e) {
        logger.debug('[OnboardingContext] Homebrew check failed, continuing:', e);
      }
    }

    // Check default legacy database location
    try {
      const legacyPath = await invoke<string | null>('check_default_legacy_database');
      if (legacyPath) {
        logger.debug('[OnboardingContext] Found legacy database, importing');
        await invoke('import_and_initialize_database', { legacyDbPath: legacyPath });
        setDatabaseExists(true);
        return;
      }
    } catch (e) {
      logger.debug('[OnboardingContext] Legacy check failed, continuing:', e);
    }

    // No legacy database found - initialize fresh
    logger.debug('[OnboardingContext] No legacy database found, initializing fresh');
    await invoke('initialize_fresh_database');
    setDatabaseExists(true);
  };

  const isCompletingRef = useRef(false);

  // Auto-save on state change (debounced)
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    // Don't auto-save if completed (to avoid overwriting completion status)
    // Also don't auto-save if we are currently in the process of completing
    if (completed || isCompletingRef.current) return;

    saveTimeoutRef.current = setTimeout(() => {
      saveOnboardingStatus();
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [currentStep, parakeetDownloaded, summaryModelDownloaded, completed]);

  // Listen to Parakeet download progress
  useEffect(() => {
    const unlisten = listen<{
      modelName: string;
      progress: number;
      downloaded_mb?: number;
      total_mb?: number;
      speed_mbps?: number;
      status?: string;
    }>(
      'parakeet-model-download-progress',
      (event) => {
        const { modelName, progress, downloaded_mb, total_mb, speed_mbps, status } = event.payload;
        if (modelName === PARAKEET_MODEL) {
          setParakeetProgress(progress);
          setParakeetProgressInfo({
            percent: progress,
            downloadedMb: downloaded_mb ?? 0,
            totalMb: total_mb ?? 0,
            speedMbps: speed_mbps ?? 0,
          });
          if (status === 'completed' || progress >= 100) {
            setParakeetDownloaded(true);
          }
        }
      }
    );

    const unlistenComplete = listen<{ modelName: string }>(
      'parakeet-model-download-complete',
      (event) => {
        const { modelName } = event.payload;
        if (modelName === PARAKEET_MODEL) {
          setParakeetDownloaded(true);
          setParakeetProgress(100);
        }
      }
    );

    const unlistenError = listen<{ modelName: string; error: string }>(
      'parakeet-model-download-error',
      (event) => {
        const { modelName } = event.payload;
        if (modelName === PARAKEET_MODEL) {
          console.error('Parakeet download error:', event.payload.error);
        }
      }
    );

    return () => {
      unlisten.then(fn => fn());
      unlistenComplete.then(fn => fn());
      unlistenError.then(fn => fn());
    };
  }, [selectedSummaryModel]);

  // Listen to summary model (Built-in AI) download progress
  useEffect(() => {
    const unlisten = listen<{
      model: string;
      progress: number;
      downloaded_mb?: number;
      total_mb?: number;
      speed_mbps?: number;
      status: string;
    }>(
      'builtin-ai-download-progress',
      (event) => {
        const { model, progress, downloaded_mb, total_mb, speed_mbps, status } = event.payload;
        // §4.1 Solo trackeamos progreso de gemma3:4b (1b ya no se descarga en onboarding).
        // Mantenemos el OR con selectedSummaryModel por si el backend reporta otro id.
        if (model === selectedSummaryModel || model === 'gemma3:4b') {
          setSummaryModelProgress(progress);
          setSummaryModelProgressInfo({
            percent: progress,
            downloadedMb: downloaded_mb ?? 0,
            totalMb: total_mb ?? 0,
            speedMbps: speed_mbps ?? 0,
          });
          if (status === 'completed' || progress >= 100) {
            setSummaryModelDownloaded(true);
          }
        }
      }
    );

    return () => {
      unlisten.then(fn => fn());
    };
  }, [selectedSummaryModel]);

  const checkDatabaseStatus = async () => {
    try {
      const isFirstLaunch = await invoke<boolean>('check_first_launch');
      setDatabaseExists(!isFirstLaunch);
      logger.debug('[OnboardingContext] Database exists:', !isFirstLaunch);
    } catch (error) {
      console.error('[OnboardingContext] Failed to check database status:', error);
      setDatabaseExists(false);
    }
  };

  const loadOnboardingStatus = async () => {
    try {
      const status = await invoke<OnboardingStatus | null>('get_onboarding_status');
      if (status) {
        logger.debug('[OnboardingContext] Loaded saved status:', status);

        // Don't trust saved status - verify actual model status on disk
        const verifiedStatus = await verifyModelStatus(status);

        setCurrentStep(verifiedStatus.currentStep);
        setCompleted(verifiedStatus.completed);
        setParakeetDownloaded(verifiedStatus.parakeetDownloaded);
        setSummaryModelDownloaded(verifiedStatus.summaryModelDownloaded);

        logger.debug('[OnboardingContext] Verified status:', verifiedStatus);

        // Check if any downloads are active to restore isBackgroundDownloading state
        await checkActiveDownloads();
      }
    } catch (error) {
      console.error('[OnboardingContext] Failed to load onboarding status:', error);
    }
  };

  // Verify that models actually exist on disk, not just trust saved JSON
  const verifyModelStatus = async (savedStatus: OnboardingStatus) => {
    let parakeetDownloaded = false;
    let summaryModelDownloaded = false;

    // Verify Parakeet model exists on disk
    try {
      await invoke('parakeet_init');
      parakeetDownloaded = await invoke<boolean>('parakeet_has_available_models');
      logger.debug('[OnboardingContext] Parakeet verified on disk:', parakeetDownloaded);
    } catch (error) {
      console.warn('[OnboardingContext] Failed to verify Parakeet:', error);
      parakeetDownloaded = false;
    }

    // Verify Summary model exists on disk - check if ANY model is available
    // Onboarding always uses builtin-ai (local models)
    try {
      const availableModel = await invoke<string | null>('builtin_ai_get_available_summary_model');
      summaryModelDownloaded = !!availableModel;
      logger.debug('[OnboardingContext] Summary model verified on disk:', summaryModelDownloaded, 'model:', availableModel);
    } catch (error) {
      console.warn('[OnboardingContext] Failed to verify Summary model:', error);
      summaryModelDownloaded = false;
    }

    // Determine the correct step based on verified status
    // Simplified flow: Step 1: Welcome, Step 2: Permissions (macOS only)
    let currentStep = savedStatus.current_step;
    const completed = savedStatus.completed;

    // Clamp step to new max (2: Welcome + Permissions)
    if (currentStep > 2) {
      currentStep = 1;
    }

    // Trust the completed status - don't revert based on model downloads
    // Downloads continue in background; user stays in main app regardless
    return {
      currentStep,
      completed,
      parakeetDownloaded,
      summaryModelDownloaded,
    };
  };

  const saveOnboardingStatus = async () => {
    // Safety check: if we are in the process of completing, DO NOT save
    // This prevents a race condition where a download completion event triggers a save
    // that overwrites the "completed" status set by completeOnboarding
    if (isCompletingRef.current) {
      logger.debug('[OnboardingContext] Skipping saveOnboardingStatus because completion is in progress');
      return;
    }

    try {
      await invoke('save_onboarding_status_cmd', {
        status: {
          version: '1.0',
          completed: completed,
          current_step: currentStep,
          model_status: {
            parakeet: parakeetDownloaded ? 'downloaded' : 'not_downloaded',
            summary: summaryModelDownloaded ? 'downloaded' : 'not_downloaded',
          },
          last_updated: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('[OnboardingContext] Failed to save onboarding status:', error);
    }
  };

  const completeOnboarding = async () => {
    try {
      // Set completion flag to prevent race conditions with auto-save
      isCompletingRef.current = true;

      // Clear any pending auto-saves
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = undefined;
      }

      // Onboarding always uses builtin-ai with selected model
      await invoke('complete_onboarding', {
        model: selectedSummaryModel,
      });
      setCompleted(true);
      logger.debug('[OnboardingContext] Onboarding completed with model:', selectedSummaryModel);

      // Reset the flag so subsequent state updates can be saved
      isCompletingRef.current = false;
    } catch (error) {
      console.error('[OnboardingContext] Failed to complete onboarding:', error);
      isCompletingRef.current = false; // Reset flag on error
      throw error; // Re-throw so PermissionsStep can handle it
    }
  };

  // Start background downloads for models (parallel - Parakeet first, then Gemma immediately)
  const startBackgroundDownloads = async (includeGemma: boolean) => {
    logger.debug('[OnboardingContext] Starting background downloads, includeGemma:', includeGemma);
    setIsBackgroundDownloading(true);

    try {
      // Start Parakeet download first (speech recognition - always required)
      if (!parakeetDownloaded) {
        logger.debug('[OnboardingContext] Starting Parakeet download');
        invoke('parakeet_download_model', { modelName: PARAKEET_MODEL })
          .catch(err => console.error('[OnboardingContext] Parakeet download failed:', err));
      }

      // Start Gemma download after a delay to prioritize Parakeet bandwidth
      if (includeGemma && !summaryModelDownloaded) {
        setTimeout(() => {
          logger.debug('[OnboardingContext] Starting Gemma download (delayed to prioritize Parakeet)');
          invoke('builtin_ai_download_model', { modelName: selectedSummaryModel || 'gemma3:4b' })
            .catch(err => console.error('[OnboardingContext] Gemma download failed:', err));
        }, 3000); // 3 second delay to give Parakeet priority
      }
    } catch (error) {
      console.error('[OnboardingContext] Failed to start background downloads:', error);
      setIsBackgroundDownloading(false);
      throw error;
    }
  };

  // Check if any models are currently downloading (for re-entry)
  const checkActiveDownloads = async () => {
    try {
      const models = await invoke<Array<{ status: unknown }>>('parakeet_get_available_models');
      const isDownloading = models.some(m => m.status && (typeof m.status === 'object' ? 'Downloading' in m.status : m.status === 'Downloading'));
      
      if (isDownloading) {
        logger.debug('[OnboardingContext] Detected active background downloads on mount');
        setIsBackgroundDownloading(true);
      }
      
      // Also check for Gemma/Built-in AI downloads if possible (though less critical as Parakeet is the main blocker)
      
    } catch (error) {
      console.warn('[OnboardingContext] Failed to check active downloads:', error);
    }
  };

  const retryParakeetDownload = async () => {
    logger.debug('[OnboardingContext] Retrying Parakeet download');
    try {
      await invoke('parakeet_retry_download', { modelName: PARAKEET_MODEL });
    } catch (error) {
      console.error('[OnboardingContext] Retry failed:', error);
      throw error;
    }
  };

  const setPermissionStatus = useCallback((permission: keyof OnboardingPermissions, status: PermissionStatus) => {
    setPermissions((prev: OnboardingPermissions) => ({
      ...prev,
      [permission]: status,
    }));
  }, []);

  const goToStep = useCallback((step: number) => {
    setCurrentStep(Math.max(1, Math.min(step, 3)));
  }, []);

  const goNext = useCallback(() => {
    setCurrentStep((prev: number) => {
      const next = prev + 1;
      // Don't go past step 3
      return Math.min(next, 3);
    });
  }, []);

  const goPrevious = useCallback(() => {
    setCurrentStep((prev: number) => {
      const previous = prev - 1;
      // Don't go below step 1
      return Math.max(previous, 1);
    });
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        currentStep,
        completed,
        parakeetDownloaded,
        parakeetProgress,
        parakeetProgressInfo,
        summaryModelDownloaded,
        summaryModelProgress,
        summaryModelProgressInfo,
        selectedSummaryModel,
        databaseExists,
        isBackgroundDownloading,
        useCloudTranscription,
        permissions,
        permissionsSkipped,
        goToStep,
        goNext,
        goPrevious,
        setParakeetDownloaded,
        setSummaryModelDownloaded,
        setSelectedSummaryModel,
        setDatabaseExists,
        setUseCloudTranscription,
        setPermissionStatus,
        setPermissionsSkipped,
        completeOnboarding,
        startBackgroundDownloads,
        retryParakeetDownload,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
