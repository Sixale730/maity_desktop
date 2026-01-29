import React from 'react';
import { AlertTriangle, Mic, Speaker, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { invoke } from '@tauri-apps/api/core';
import { useIsLinux } from '@/hooks/usePlatform';

interface PermissionWarningProps {
  hasMicrophone: boolean;
  hasSystemAudio: boolean;
  onRecheck: () => void;
  isRechecking?: boolean;
}

export function PermissionWarning({
  hasMicrophone,
  hasSystemAudio,
  onRecheck,
  isRechecking = false
}: PermissionWarningProps) {
  const isLinux = useIsLinux();

  // Don't show on Linux - permission handling is not needed
  if (isLinux) {
    return null;
  }

  // Don't show if both permissions are granted
  if (hasMicrophone && hasSystemAudio) {
    return null;
  }

  const isMacOS = navigator.userAgent.includes('Mac');

  const openMicrophoneSettings = async () => {
    if (isMacOS) {
      try {
        await invoke('open_system_settings', { preferencePane: 'Privacy_Microphone' });
      } catch (error) {
        console.error('Failed to open microphone settings:', error);
      }
    }
  };

  const openScreenRecordingSettings = async () => {
    if (isMacOS) {
      try {
        await invoke('open_system_settings', { preferencePane: 'Privacy_ScreenCapture' });
      } catch (error) {
        console.error('Failed to open screen recording settings:', error);
      }
    }
  };

  return (
    <div className="max-w-md mb-4 space-y-3">
      {/* Combined Permission Warning - Show when either permission is missing */}
      {(!hasMicrophone || !hasSystemAudio) && (
        <Alert variant="destructive" className="border-amber-400 bg-amber-50">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <AlertTitle className="text-amber-900 font-semibold">
            <div className="flex items-center gap-2">
              {!hasMicrophone && <Mic className="h-4 w-4" />}
              {!hasSystemAudio && <Speaker className="h-4 w-4" />}
              {!hasMicrophone && !hasSystemAudio ? 'Permisos Requeridos' : !hasMicrophone ? 'Permiso de Micrófono Requerido' : 'Permiso de Audio del Sistema Requerido'}
            </div>
          </AlertTitle>
          {/* Action Buttons */}
          <div className="mt-4 flex flex-wrap gap-2">
            {isMacOS && !hasMicrophone && (
              <button
                onClick={openMicrophoneSettings}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors"
              >
                <Mic className="h-4 w-4" />
                Abrir Configuración del Micrófono
              </button>
            )}
            {isMacOS && !hasSystemAudio && (
              <button
                onClick={openScreenRecordingSettings}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#3a4ac3] hover:bg-[#2b3892] rounded-md transition-colors"
              >
                <Speaker className="h-4 w-4" />
                Abrir Configuración de Grabación de Pantalla
              </button>
            )}
            <button
              onClick={onRecheck}
              disabled={isRechecking}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 rounded-md transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isRechecking ? 'animate-spin' : ''}`} />
              Verificar de Nuevo
            </button>
          </div>
          <AlertDescription className="text-amber-800 mt-2">
            {/* Microphone Warning */}
            {!hasMicrophone && (
              <>
                <p className="mb-3">
                  Maity necesita acceso a tu micrófono para grabar reuniones. No se detectaron dispositivos de micrófono.
                </p>
                <div className="space-y-2 text-sm mb-4">
                  <p className="font-medium">Por favor verifica:</p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li>Tu micrófono está conectado y encendido</li>
                    <li>El permiso de micrófono está otorgado en Configuración del Sistema</li>
                    <li>Ninguna otra aplicación está usando el micrófono exclusivamente</li>
                  </ul>
                </div>
              </>
            )}

            {/* System Audio Warning */}
            {!hasSystemAudio && (
              <>
                <p className="mb-3">
                  {hasMicrophone
                    ? 'La captura de audio del sistema no está disponible. Aún puedes grabar con tu micrófono, pero el audio de la computadora no será capturado.'
                    : 'La captura de audio del sistema tampoco está disponible.'}
                </p>
                {isMacOS && (
                  <div className="space-y-2 text-sm mb-4">
                    <p className="font-medium">Para habilitar audio del sistema en macOS:</p>
                    <ul className="list-disc list-inside ml-2 space-y-1">
                      <li>Instala un dispositivo de audio virtual (ej., BlackHole 2ch)</li>
                      <li>Otorga permiso de Grabación de Pantalla a Maity</li>
                      <li>Configura tu enrutamiento de audio en Configuración de Audio MIDI</li>
                    </ul>
                  </div>
                )}
              </>
            )}


          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
