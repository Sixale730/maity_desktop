"use client";
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Speaker, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AudioOutputInfo {
  device_name: string;
  is_bluetooth: boolean;
  sample_rate: number | null;
  device_type: string;
}

interface BluetoothPlaybackWarningProps {
  /** Check interval in milliseconds (default: 5000ms / 5 seconds) */
  checkInterval?: number;
  /** Whether to show the warning (default: true for meeting playback pages) */
  enabled?: boolean;
}

export function BluetoothPlaybackWarning({
  checkInterval = 5000,
  enabled = true
}: BluetoothPlaybackWarningProps) {
  const [isBluetoothActive, setIsBluetoothActive] = useState(false);
  const [deviceName, setDeviceName] = useState<string>('');
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const checkAudioOutput = async () => {
      try {
        const outputInfo = await invoke<AudioOutputInfo>('get_active_audio_output');

        if (outputInfo.is_bluetooth) {
          setIsBluetoothActive(true);
          setDeviceName(outputInfo.device_name);
        } else {
          setIsBluetoothActive(false);
          setIsDismissed(false); // Reset dismissal when switching to non-BT device
        }
      } catch (error) {
        console.error('Failed to check audio output device:', error);
        // Fail silently - don't show warning if we can't detect device
        setIsBluetoothActive(false);
      }
    };

    // Check immediately on mount
    checkAudioOutput();

    // Set up periodic checks
    const interval = setInterval(checkAudioOutput, checkInterval);

    return () => clearInterval(interval);
  }, [checkInterval, enabled]);

  // Don't show warning if Bluetooth not active, already dismissed, or not enabled
  if (!enabled || !isBluetoothActive || isDismissed) {
    return null;
  }

  return (
    <Alert
      className="mb-4 border-[#485df4] bg-[#f0f2fe] text-[#1e2a6e]"
      role="alert"
      aria-live="polite"
    >
      <Speaker className="h-4 w-4 text-[#3a4ac3]" />
      <div className="flex items-start justify-between w-full">
        <div className="flex-1">
          <AlertTitle className="text-[#1e2a6e] font-semibold">
            Reproducción Bluetooth Detectada
          </AlertTitle>
          <AlertDescription className="text-[#2b3892] mt-1">
            Estás usando <strong>{deviceName}</strong> para reproducción.
            Las grabaciones pueden sonar distorsionadas o aceleradas a través de dispositivos Bluetooth.
            Para una revisión precisa, por favor usa <strong>altavoces de computadora</strong> o{' '}
            <strong>auriculares con cable</strong>.
            <br />
            <a
              href="https://github.com/your-org/maity/blob/main/BLUETOOTH_PLAYBACK_NOTICE.md"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#1e2a6e] font-medium mt-2 inline-block"
            >
              Aprende por qué sucede esto →
            </a>
          </AlertDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsDismissed(true)}
          className="ml-4 h-6 w-6 text-yellow-700 hover:text-[#1e2a6e] hover:bg-[#e0e5fd]"
          aria-label="Descartar advertencia"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </Alert>
  );
}
