import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { DeviceSelection } from '@/components/recording/DeviceSelection';
import type { SelectedDevices } from '@/types/audio';
import type { RecordingPreferences } from '@/types/audio';
import Analytics from '@/lib/analytics';
import { toast } from 'sonner';
import { useConfig } from '@/contexts/ConfigContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useUserRole } from '@/hooks/useUserRole';
import { stripDeviceTypeSuffix } from '@/lib/deviceName';
import { resetTranscriptionModeCache } from '@/lib/transcriptionMode';

export type { RecordingPreferences };

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

// El control de retención de audio vive DENTRO de este componente a propósito.
// `set_recording_preferences` REEMPLAZA el objeto entero (no mergea), así que un
// componente hermano con su propio get/set produciría una carrera: el que
// guarde segundo pisa el campo que el otro acababa de cambiar. Mismo motivo por
// el que `ConfigContext.updateSelectedDevices` hace read-merge-write serializado
// (ver CLAUDE.md § Convenciones). Cualquier preferencia nueva de
// `RecordingPreferences` debe entrar por este mismo objeto de estado.
export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: '',
    auto_save: true,
    file_format: 'mp4',
    preferred_mic_device: null,
    preferred_system_device: null,
    audio_retention_days: 30
  });
  const [loading, setLoading] = useState(true);
  // `true` SOLO tras un `get_recording_preferences` exitoso. El literal inicial
  // de arriba no trae `transcription_mode` (ni cualquier campo futuro) y
  // `set_recording_preferences` REEMPLAZA el objeto entero: si la carga falla y
  // el usuario guarda, el campo ausente vuelve al default del build (que en un
  // build piloto `MAITY_PILOT_BATCH=1` es `batch` — ver `types/audio.ts`). Sin
  // carga exitosa no se guarda nada; el parche de `save_folder` del catch es
  // sólo para pintar la ruta.
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showRecordingNotification, setShowRecordingNotification] = useState(true);
  // Setter crudo del contexto (savePreferences ya persiste; con
  // updateSelectedDevices se escribiría el JSON dos veces). Sin esto,
  // /settings guardaba pero el ConfigContext quedaba stale hasta reiniciar.
  const { setSelectedDevices } = useConfig();
  // Modo de transcripción (F4/F5): opción SOLO para admins mientras el default
  // siga en streaming (sin flip F6). Fail-closed: `roleKnown` evita pintar el
  // control con el rol en el aire o con la RPC caída (issue #68).
  const { isAdmin, roleKnown } = useUserRole();
  // En lote el coach es por audio y nada consume el sidecar → el modelo de
  // resumen deja de ser requisito; al volver a streaming hay que relanzar la
  // descarga que se omitió. Ambos puntos de montaje de este componente viven
  // bajo `(main)/layout.tsx` → OnboardingProvider disponible.
  const { refreshSummaryModelRequired, startBackgroundDownloads } = useOnboarding();

  // Load recording preferences on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
        setPreferences(prefs);
        setLoaded(true);
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

  const handleRetentionChange = async (days: number) => {
    const newPreferences = { ...preferences, audio_retention_days: days };
    setPreferences(newPreferences);
    // Toast propio: el de por defecto habla de micrófono y audio del sistema, y
    // aquí lo que cambió es una preferencia cuyo efecto es BORRAR archivos.
    // Confirmar un cambio destructivo con la descripción de otra cosa es peor
    // que no confirmarlo.
    await savePreferences(newPreferences, {
      title: 'Retención de audio actualizada',
      description:
        days === 0
          ? 'El audio de las reuniones guardadas no se borrará automáticamente.'
          : `El audio se conservará ${days} días después de sincronizar la reunión.`
    });

    await Analytics.track('audio_retention_days_changed', {
      days: days.toString()
    });
  };

  // Espejo de handleRetentionChange: mismo objeto de estado, mismo escritor
  // (`savePreferences` — `set_recording_preferences` reemplaza el JSON entero).
  const handleTranscriptionModeChange = async (mode: 'streaming' | 'batch') => {
    const newPreferences = { ...preferences, transcription_mode: mode };
    setPreferences(newPreferences);
    await savePreferences(newPreferences, {
      title: 'Modo de transcripción actualizado',
      description:
        mode === 'batch'
          ? 'Las siguientes grabaciones se transcribirán al terminar.'
          : 'Las siguientes grabaciones se transcribirán en vivo.',
    });

    // `lib/transcriptionMode` cachea la preferencia por sesión; sin este reset
    // OnboardingContext seguiría decidiendo con el valor viejo.
    resetTranscriptionModeCache();
    await refreshSummaryModelRequired();
    if (mode === 'streaming') {
      // Al salir del lote el coach vuelve a necesitar Gemma (si el tier lo
      // permite): relanzar la descarga que el kickoff omitió. Es idempotente
      // (promesa de arranque reusada) y no bloquea el guardado.
      void startBackgroundDownloads(true);
    }

    await Analytics.track('transcription_mode_changed', { mode });
  };

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const newPreferences = {
      ...preferences,
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice
    };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);
    setSelectedDevices({
      micDevice: stripDeviceTypeSuffix(devices.micDevice),
      systemDevice: stripDeviceTypeSuffix(devices.systemDevice),
    });

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
      toast.error('No se pudo abrir la carpeta de grabaciones', {
        description: error instanceof Error ? error.message : String(error),
        duration: 5000,
      });
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

  // `successToast` lo pasa quien cambió algo que NO son los dispositivos: el
  // mensaje por defecto describe micrófono y audio del sistema, así que usarlo
  // para otra preferencia confirma un cambio distinto del que hizo el usuario.
  const savePreferences = async (
    prefs: RecordingPreferences,
    successToast?: { title: string; description?: string }
  ) => {
    // Defensa en profundidad además del `disabled` de los controles: un objeto
    // que no salió de una carga exitosa pisaría campos que no se pudieron leer.
    if (!loaded) {
      toast.error('No se pudieron cargar las preferencias de grabación', {
        description: 'Recarga la página antes de cambiar la configuración; guardar ahora pisaría valores no leídos.',
      });
      return;
    }
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: prefs });
      onSave?.(prefs);

      if (successToast) {
        toast.success(successToast.title, { description: successToast.description });
      } else {
        // Show success toast with device details
        const micDevice = prefs.preferred_mic_device || 'Default';
        const systemDevice = prefs.preferred_system_device || 'Default';
        toast.success("Preferencias de dispositivo guardadas", {
          description: `Micrófono: ${micDevice}, Audio del Sistema: ${systemDevice}`
        });
      }
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

  // Controles que escriben `RecordingPreferences`: bloqueados mientras se
  // guarda Y hasta que la carga haya tenido éxito (ver `loaded`).
  const prefsLocked = saving || !loaded;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Configuración de Grabación</h3>
        <p className="text-sm text-[#4a4a4c] dark:text-gray-300 mb-6">
          Configura cómo se guardan tus grabaciones de audio durante las reuniones.
        </p>
      </div>

      {!loaded && (
        <div
          className="p-4 border border-amber-300 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-800 dark:text-amber-300"
          data-testid="recording-preferences-load-failed"
        >
          No se pudieron cargar las preferencias de grabación. Recarga la página para
          poder editarlas: guardar ahora pisaría valores que no se pudieron leer.
        </div>
      )}

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
          disabled={prefsLocked}
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
            La grabación de audio está deshabilitada. Habilita &quot;Guardar Grabaciones de Audio&quot; para guardar automáticamente el audio de tus reuniones.
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

      {/* System Audio Gain */}
      <div className="p-4 border rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="font-medium">Volumen de Audio del Sistema</div>
            <div className="text-sm text-[#4a4a4c] dark:text-gray-300">
              Amplifica el audio capturado del sistema (bocinas/audífonos) sin cambiar el volumen del OS
            </div>
          </div>
          <span className="text-sm font-mono font-bold text-[#485df4] min-w-[3rem] text-right">
            {((preferences.system_audio_gain ?? 1.5) * 100).toFixed(0)}%
          </span>
        </div>
        <input
          type="range"
          min="50"
          max="300"
          step="10"
          value={(preferences.system_audio_gain ?? 1.5) * 100}
          disabled={prefsLocked}
          onChange={async (e) => {
            const gain = parseInt(e.target.value) / 100;
            const newPreferences = { ...preferences, system_audio_gain: gain };
            setPreferences(newPreferences);
            await savePreferences(newPreferences);
          }}
          className="w-full h-2 bg-[#1a1a2e] rounded-lg appearance-none cursor-pointer accent-[#485df4]"
        />
        <div className="flex justify-between text-xs text-[#8a8a8d] mt-1">
          <span>50%</span>
          <span>150% (predeterminado)</span>
          <span>300%</span>
        </div>
      </div>

      {/* Retención de Audio */}
      <div className="p-4 border rounded-lg">
        <div className="font-medium mb-1">Conservar el Audio de las Reuniones</div>
        <div className="text-sm text-[#4a4a4c] dark:text-gray-300 mb-3">
          Después de este tiempo se libera el archivo de audio de las reuniones que
          ya se sincronizaron y analizaron. La transcripción y los datos de la
          reunión se conservan siempre: sólo se borra el audio.
        </div>
        <select
          value={preferences.audio_retention_days ?? 30}
          onChange={(e) => handleRetentionChange(parseInt(e.target.value, 10))}
          disabled={prefsLocked}
          className="w-full px-3 py-2 text-sm border border-[#d0d0d3] dark:border-gray-600 rounded-md bg-transparent disabled:opacity-50"
        >
          {/*
            El texto dice "de las reuniones guardadas" y no "Nunca borrar el audio"
            a secas porque esta preferencia NO gobierna todo el audio del disco: los
            segmentos de jornada que se descartan por contenido insuficiente
            (< 250 palabras) liberan su audio de inmediato, sin consultarla —
            su carpeta nunca llega a ser una reunión guardada y nadie más podría
            alcanzarla después. Ver CLAUDE.md § Umbral de contenido de la jornada.
          */}
          <option value={0}>Nunca borrar el audio de las reuniones guardadas</option>
          <option value={7}>7 días</option>
          <option value={30}>30 días (recomendado)</option>
          <option value={90}>90 días</option>
        </select>
        <div className="text-xs text-[#8a8a8d] mt-2">
          Una hora de reunión ocupa alrededor de 29 MB. Con &quot;Nunca borrar&quot; el
          espacio en disco crece sin límite. Los segmentos de jornada que se
          descartan por no tener suficiente conversación liberan su audio de
          inmediato en cualquier caso.
        </div>
      </div>

      {/* Modo de transcripción (F4/F5) — solo admins mientras el default sea streaming */}
      {isAdmin && roleKnown && (
        <div className="p-4 border rounded-lg" data-testid="transcription-mode-setting">
          <div className="font-medium mb-1">Modo de Transcripción</div>
          <div className="text-sm text-[#4a4a4c] dark:text-gray-300 mb-3">
            Elige cuándo se convierte el audio en texto. Transcribir al terminar usa
            menos memoria mientras grabas; a cambio, la transcripción y el coach con
            IA llegan cuando la grabación se cierra.
          </div>
          <select
            value={preferences.transcription_mode ?? 'streaming'}
            onChange={(e) =>
              handleTranscriptionModeChange(e.target.value === 'batch' ? 'batch' : 'streaming')
            }
            disabled={prefsLocked}
            className="w-full px-3 py-2 text-sm border border-[#d0d0d3] dark:border-gray-600 rounded-md bg-transparent disabled:opacity-50"
          >
            <option value="streaming">Streaming en vivo (transcribe mientras grabas)</option>
            <option value="batch">Por lote al terminar (menos memoria durante la grabación)</option>
          </select>
          <div className="text-xs text-[#8a8a8d] mt-2">
            Aplica a la siguiente grabación; la que esté en curso conserva su modo.
            En modo por lote el coach en vivo mide tiempo de palabra y monólogos por
            audio, sin tips de IA.
          </div>
          {!preferences.auto_save && (preferences.transcription_mode ?? 'streaming') === 'batch' && (
            <div className="mt-3 p-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-800 dark:text-amber-300">
              Sin &quot;Guardar Grabaciones de Audio&quot; no hay qué transcribir después:
              las grabaciones se transcribirán en vivo aunque este modo diga &quot;por lote&quot;.
            </div>
          )}
        </div>
      )}

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
              disabled={prefsLocked}
            />
          </div>
        </div>
      </div>
    </div>
  );
}