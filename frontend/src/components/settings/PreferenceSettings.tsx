"use client"

import { useEffect, useState, useRef } from "react"
import { Switch } from "@/components/ui/switch"
import { FolderOpen, LogOut, Palette, Download, Loader2 } from "lucide-react"
import { listen } from '@tauri-apps/api/event'
import { ThemeSelector } from "@/components/settings/ThemeSelector"
import { invoke } from "@tauri-apps/api/core"
import Analytics from "@/lib/analytics"
import AnalyticsConsentSwitch from "@/components/analytics/AnalyticsConsentSwitch"
import { useConfig, NotificationSettings } from "@/contexts/ConfigContext"
import { useAuth } from "@/contexts/AuthContext"
import { LogExporter } from "@/components/settings/LogExporter"
import { RecordingLogsViewer } from "@/components/settings/RecordingLogsViewer"
import { logger } from "@/lib/logger"

export function PreferenceSettings() {
  const {
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings,
    coachEnabled,
    setCoachEnabled,
  } = useConfig();

  const { signOut, user } = useAuth();

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [previousNotificationsEnabled, setPreviousNotificationsEnabled] = useState<boolean | null>(null);
  const [coachModelReady, setCoachModelReady] = useState<boolean | null>(null);
  const [coachDownloadProgress, setCoachDownloadProgress] = useState<number | null>(null);
  const [coachDownloadError, setCoachDownloadError] = useState<string | null>(null);

  // Check if coach model is ready when coach is enabled
  useEffect(() => {
    if (!coachEnabled) return;
    const checkModel = async () => {
      try {
        const ready = await invoke<boolean>('builtin_ai_is_model_ready', { modelName: 'gemma3:1b' });
        setCoachModelReady(ready);
      } catch {
        setCoachModelReady(false);
      }
    };
    checkModel();
  }, [coachEnabled]);

  const handleDownloadCoachModel = async () => {
    setCoachDownloadProgress(0);
    setCoachDownloadError(null);

    const unlistenProgress = await listen<{ model: string; progress: number; downloaded_mb: number; total_mb: number; speed_mbps: number; status: string }>('builtin-ai-download-progress', (event) => {
      if (event.payload.model === 'gemma3:1b') {
        setCoachDownloadProgress(event.payload.progress);
        if (event.payload.status === 'completed') {
          setCoachDownloadProgress(null);
          setCoachModelReady(true);
          unlistenProgress();
        }
      }
    });

    try {
      await invoke('builtin_ai_download_model', { modelName: 'gemma3:1b' });
    } catch (e) {
      setCoachDownloadProgress(null);
      setCoachDownloadError(e instanceof Error ? e.message : String(e));
      unlistenProgress();
    }
  };

  const hasTrackedViewRef = useRef(false);

  // Lazy load preferences on mount (only loads if not already cached)
  useEffect(() => {
    loadPreferences();
    // Reset tracking ref on mount (every tab visit)
    hasTrackedViewRef.current = false;
  }, [loadPreferences]);

  // Track preferences viewed analytics on every tab visit (once per mount)
  useEffect(() => {
    if (hasTrackedViewRef.current) return;

    const trackPreferencesViewed = async () => {
      // Wait for notification settings to be available (either from cache or after loading)
      if (notificationSettings) {
        await Analytics.track('preferences_viewed', {
          notifications_enabled: notificationSettings.notification_preferences.show_recording_started ? 'true' : 'false'
        });
        hasTrackedViewRef.current = true;
      } else if (!isLoadingPreferences) {
        // If not loading and no settings available, track with default value
        await Analytics.track('preferences_viewed', {
          notifications_enabled: 'false'
        });
        hasTrackedViewRef.current = true;
      }
    };

    trackPreferencesViewed();
  }, [notificationSettings, isLoadingPreferences]);

  // Update notificationsEnabled when notificationSettings are loaded from global state
  useEffect(() => {
    if (notificationSettings) {
      // Notification enabled means both started and stopped notifications are enabled
      const enabled =
        notificationSettings.notification_preferences.show_recording_started &&
        notificationSettings.notification_preferences.show_recording_stopped;
      setNotificationsEnabled(enabled);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(enabled);
        setIsInitialLoad(false);
      }
    } else if (!isLoadingPreferences) {
      // If not loading and no settings, use default
      setNotificationsEnabled(true);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(true);
        setIsInitialLoad(false);
      }
    }
  }, [notificationSettings, isLoadingPreferences, isInitialLoad])

  useEffect(() => {
    // Skip update on initial load or if value hasn't actually changed
    if (isInitialLoad || notificationsEnabled === null || notificationsEnabled === previousNotificationsEnabled) return;
    if (!notificationSettings) return;

    const handleUpdateNotificationSettings = async () => {
      logger.debug("Updating notification settings to:", notificationsEnabled);

      try {
        // Update the notification preferences
        const updatedSettings: NotificationSettings = {
          ...notificationSettings,
          notification_preferences: {
            ...notificationSettings.notification_preferences,
            show_recording_started: notificationsEnabled,
            show_recording_stopped: notificationsEnabled,
          }
        };

        logger.debug("Calling updateNotificationSettings with:", updatedSettings);
        await updateNotificationSettings(updatedSettings);
        setPreviousNotificationsEnabled(notificationsEnabled);
        logger.debug("Successfully updated notification settings to:", notificationsEnabled);

        // Track notification preference change - only fires when user manually toggles
        await Analytics.track('notification_settings_changed', {
          notifications_enabled: notificationsEnabled.toString()
        });
      } catch (error) {
        console.error('Failed to update notification settings:', error);
      }
    };

    handleUpdateNotificationSettings();
  }, [notificationsEnabled, notificationSettings, isInitialLoad, previousNotificationsEnabled, updateNotificationSettings])

  const handleOpenFolder = async (folderType: 'database' | 'models' | 'recordings') => {
    try {
      switch (folderType) {
        case 'database':
          await invoke('open_database_folder');
          break;
        case 'models':
          await invoke('open_models_folder');
          break;
        case 'recordings':
          await invoke('open_recordings_folder');
          break;
      }

      // Track storage folder access
      await Analytics.track('storage_folder_opened', {
        folder_type: folderType
      });
    } catch (error) {
      console.error(`Failed to open ${folderType} folder:`, error);
    }
  };

  // Show loading only if we're actually loading and don't have cached data
  if (isLoadingPreferences && !notificationSettings && !storageLocations) {
    return <div className="max-w-2xl mx-auto p-6">Cargando Preferencias...</div>
  }

  // Show loading if notificationsEnabled hasn't been determined yet
  if (notificationsEnabled === null && !isLoadingPreferences) {
    return <div className="max-w-2xl mx-auto p-6">Cargando Preferencias...</div>
  }

  // Ensure we have a boolean value for the Switch component
  const notificationsEnabledValue = notificationsEnabled ?? false;

  return (
    <div className="space-y-6">
      {/* Theme Section */}
      <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="w-5 h-5 text-foreground" />
          <h3 className="text-lg font-semibold text-foreground">Tema</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Elige la paleta de colores para la interfaz
        </p>
        <ThemeSelector />
      </div>

      {/* Notifications Section */}
      <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Notificaciones</h3>
            <p className="text-sm text-muted-foreground">Habilitar o deshabilitar notificaciones de inicio y fin de reunión</p>
          </div>
          <Switch checked={notificationsEnabledValue} onCheckedChange={setNotificationsEnabled} />
        </div>
      </div>

      {/* Data Storage Locations Section */}
      <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-foreground mb-4">Ubicaciones de Almacenamiento de Datos</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Ver y acceder donde Maity almacena tus datos
        </p>

        <div className="space-y-4">
          {/* Recordings Location */}
          <div className="p-4 border border-border rounded-lg bg-secondary">
            <div className="font-medium mb-2 text-foreground">Grabaciones de Reuniones</div>
            <div className="text-sm text-muted-foreground mb-3 break-all font-mono text-xs">
              {storageLocations?.recordings || 'Cargando...'}
            </div>
            <button
              onClick={() => handleOpenFolder('recordings')}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors text-foreground"
            >
              <FolderOpen className="w-4 h-4" />
              Abrir Carpeta
            </button>
          </div>
        </div>

        <div className="mt-4 p-3 bg-primary/10 rounded-md">
          <p className="text-xs text-primary">
            <strong>Nota:</strong> La base de datos y los modelos se almacenan juntos en el directorio de datos de tu aplicación para una gestión unificada.
          </p>
        </div>
      </div>

      {/* Coach Overlay Section */}
      <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-foreground mb-1">Coach en Tiempo Real</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Muestra sugerencias de preguntas durante tus llamadas usando un modelo local con Ollama.
        </p>

        <div className="flex items-center justify-between mb-4">
          <div>
            <label className="text-sm font-medium text-foreground">Activar Coach</label>
            <p className="text-xs text-muted-foreground">Aparece automaticamente al grabar</p>
          </div>
          <Switch
            checked={coachEnabled}
            onCheckedChange={setCoachEnabled}
          />
        </div>

        {coachEnabled && (
          <div className="space-y-3 pt-2 border-t border-border">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Modelo: Gemma 3 1B</label>
              {coachModelReady ? (
                <div className="flex items-center gap-2 p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs text-emerald-400">Modelo listo (~1 GB)</span>
                </div>
              ) : coachDownloadProgress !== null ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    <span className="text-xs text-foreground">Descargando Gemma 3 1B... {coachDownloadProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${coachDownloadProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Descarga el modelo para usar el Coach. Se ejecuta localmente, sin internet.
                  </p>
                  <button
                    onClick={handleDownloadCoachModel}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/15 text-primary border border-primary/30 rounded-md hover:bg-primary/25 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Descargar Gemma 3 1B (~1 GB)
                  </button>
                </div>
              )}
              {coachDownloadError && (
                <p className="text-xs text-red-400 mt-1">{coachDownloadError}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Analytics Section */}
      <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
        <AnalyticsConsentSwitch />
      </div>

      {/* Account Section */}
      <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-foreground mb-4">Cuenta</h3>
        {user?.email && (
          <p className="text-sm text-foreground mb-4">
            {user.email}
          </p>
        )}
        <button
          onClick={signOut}
          className="flex items-center gap-2 px-4 py-2 text-sm text-primary border border-primary/50 rounded-md hover:bg-primary/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </div>

      {/* Diagnostics & Support */}
      <div className="bg-card rounded-lg border border-border p-6 shadow-sm space-y-4">
        <h3 className="text-lg font-semibold text-foreground">Diagnóstico y Soporte</h3>
        <RecordingLogsViewer />
        <LogExporter />
      </div>
    </div>
  )
}
