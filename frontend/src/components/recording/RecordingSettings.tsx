import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { DeviceSelection } from '@/components/recording/DeviceSelection';
import type { SelectedDevices } from '@/types/audio';
import type { RecordingPreferences } from '@/types/audio';
import Analytics from '@/lib/analytics';
import { toast } from 'sonner';

export type { RecordingPreferences };

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: '',
    auto_save: true,
    file_format: 'mp4',
    preferred_mic_device: null,
    preferred_system_device: null
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRecordingNotification, setShowRecordingNotification] = useState(true);

  // Load recording preferences on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
        setPreferences(prefs);
      } catch (error) {
        console.error('Failed to load recording preferences:', error);
        // If loading fails, get default folder path
        try {
          const defaultPath = await invoke<string>('get_default_recordings_folder_path');
          setPreferences(prev => ({ ...prev, save_folder: defaultPath }));
        } catch (defaultError) {
          console.error('Failed to get default folder path:', defaultError);
        }
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, []);

  // Load recording notification preference
  useEffect(() => {
    const loadNotificationPref = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const show = await store.get<boolean>('show_recording_notification') ?? true;
        setShowRecordingNotification(show);
      } catch (error) {
        console.error('Failed to load notification preference:', error);
      }
    };
    loadNotificationPref();
  }, []);

  const handleAutoSaveToggle = async (enabled: boolean) => {
    const newPreferences = { ...preferences, auto_save: enabled };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    // Track auto-save setting change
    await Analytics.track('auto_save_recording_toggled', {
      enabled: enabled.toString()
    });
  };

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const newPreferences = {
      ...preferences,
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice
    };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    // Track default device preference changes
    // Note: Individual device selection analytics are tracked in DeviceSelection component
    await Analytics.track('default_devices_changed', {
      has_preferred_microphone: (!!devices.micDevice).toString(),
      has_preferred_system_audio: (!!devices.systemDevice).toString()
    });
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
    }
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    try {
      setShowRecordingNotification(enabled);
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('show_recording_notification', enabled);
      await store.save();
      toast.success('Preferencia guardada');
      await Analytics.track('recording_notification_preference_changed', {
        enabled: enabled.toString()
      });
    } catch (error) {
      console.error('Failed to save notification preference:', error);
      toast.error('Error al guardar preferencia');
    }
  };

  const savePreferences = async (prefs: RecordingPreferences) => {
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: prefs });
      onSave?.(prefs);

      // Show success toast with device details
      const micDevice = prefs.preferred_mic_device || 'Default';
      const systemDevice = prefs.preferred_system_device || 'Default';
      toast.success("Preferencias de dispositivo guardadas", {
        description: `Micrófono: ${micDevice}, Audio del Sistema: ${systemDevice}`
      });
    } catch (error) {
      console.error('Failed to save recording preferences:', error);
      toast.error("Error al guardar preferencias de dispositivo", {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-[#d0d0d3] dark:bg-gray-600 rounded w-1/4 mb-4"></div>
        <div className="h-8 bg-[#d0d0d3] dark:bg-gray-600 rounded mb-4"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Configuración de Grabación</h3>
        <p className="text-sm text-[#4a4a4c] dark:text-gray-300 mb-6">
          Configura cómo se guardan tus grabaciones de audio durante las reuniones.
        </p>
      </div>

      {/* Auto Save Toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex-1">
          <div className="font-medium">Guardar Grabaciones de Audio</div>
          <div className="text-sm text-[#4a4a4c] dark:text-gray-300">
            Guardar automáticamente archivos de audio al detener la grabación
          </div>
        </div>
        <Switch
          checked={preferences.auto_save}
          onCheckedChange={handleAutoSaveToggle}
          disabled={saving}
        />
      </div>

      {/* Folder Location - Only shown when auto_save is enabled */}
      {preferences.auto_save && (
        <div className="space-y-4">
          <div className="p-4 border rounded-lg bg-[#f5f5f6] dark:bg-gray-800">
            <div className="font-medium mb-2">Ubicación de Guardado</div>
            <div className="text-sm text-[#4a4a4c] dark:text-gray-300 mb-3 break-all">
              {preferences.save_folder || 'Carpeta predeterminada'}
            </div>
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-[#d0d0d3] dark:border-gray-600 rounded-md hover:bg-[#f5f5f6] dark:hover:bg-gray-700 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Abrir Carpeta
            </button>
          </div>

          <div className="p-4 border rounded-lg bg-[#f0f2fe] dark:bg-blue-900/30">
            <div className="text-sm text-[#1e2a6e] dark:text-blue-300">
              <strong>Formato de Archivo:</strong> Archivos {preferences.file_format.toUpperCase()}
            </div>
            <div className="text-xs text-[#3a4ac3] dark:text-blue-400 mt-1">
              Las grabaciones se guardan con marca de tiempo: grabacion_YYYYMMDD_HHMMSS.{preferences.file_format}
            </div>
          </div>
        </div>
      )}

      {/* Info when auto_save is disabled */}
      {!preferences.auto_save && (
        <div className="p-4 border rounded-lg bg-[#f0f2fe] dark:bg-blue-900/30">
          <div className="text-sm text-[#2b3892] dark:text-blue-300">
            La grabación de audio está deshabilitada. Habilita "Guardar Grabaciones de Audio" para guardar automáticamente el audio de tus reuniones.
          </div>
        </div>
      )}

      {/* Recording Notification Toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex-1">
          <div className="font-medium">Notificación de Inicio de Grabación</div>
          <div className="text-sm text-[#4a4a4c] dark:text-gray-300">
            Mostrar recordatorio de aviso legal para informar a los participantes cuando inicia la grabación (cumplimiento legal)
          </div>
        </div>
        <Switch
          checked={showRecordingNotification}
          onCheckedChange={handleNotificationToggle}
        />
      </div>

      {/* Device Preferences */}
      <div className="space-y-4">
        <div className="border-t pt-6">
          <h4 className="text-base font-medium text-[#000000] dark:text-white mb-4">Dispositivos de Audio Predeterminados</h4>
          <p className="text-sm text-[#4a4a4c] dark:text-gray-300 mb-4">
            Configura tus dispositivos de micrófono y audio del sistema preferidos para grabar. Estos se seleccionarán automáticamente al iniciar nuevas grabaciones.
          </p>

          <div className="border rounded-lg p-4 bg-[#f5f5f6] dark:bg-gray-800">
            <DeviceSelection
              selectedDevices={{
                micDevice: preferences.preferred_mic_device,
                systemDevice: preferences.preferred_system_device
              }}
              onDeviceChange={handleDeviceChange}
              disabled={saving}
            />
          </div>
        </div>
      </div>
    </div>
  );
}