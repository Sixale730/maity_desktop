'use client';

import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronUp, Loader2 } from 'lucide-react';
import type { AudioDevice } from '@/types/audio';

interface InlineDeviceSelectorProps {
  currentMicDevice: string | null;
  currentSystemDevice: string | null;
  onDeviceSwitched: (deviceName: string, deviceType: 'Microphone' | 'SystemAudio') => void;
  /** When false (preview), selecting a device only updates preferences without hot-swapping */
  isRecording?: boolean;
}

export function InlineDeviceSelector({
  currentMicDevice,
  currentSystemDevice,
  onDeviceSwitched,
  isRecording = true,
}: InlineDeviceSelectorProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [openDropdown, setOpenDropdown] = useState<'mic' | 'system' | null>(null);
  const [switching, setSwitching] = useState<'mic' | 'system' | null>(null);

  const inputDevices = devices.filter((d) => d.device_type === 'Input');
  const outputDevices = devices.filter((d) => d.device_type === 'Output');

  const fetchDevices = useCallback(async () => {
    try {
      const result = await invoke<AudioDevice[]>('get_audio_devices');
      setDevices(result);
    } catch (err) {
      console.error('Failed to fetch audio devices:', err);
    }
  }, []);

  // Pre-fetch devices on mount so the list is ready before first open
  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const handleOpen = useCallback(
    (type: 'mic' | 'system') => {
      if (openDropdown === type) {
        setOpenDropdown(null);
      } else {
        fetchDevices();
        setOpenDropdown(type);
      }
    },
    [openDropdown, fetchDevices],
  );

  const handleSelect = useCallback(
    async (deviceName: string, deviceType: 'Microphone' | 'SystemAudio') => {
      setOpenDropdown(null);

      if (!isRecording) {
        // Preview mode: just update the preference, no hot-swap needed
        onDeviceSwitched(deviceName, deviceType);
        return;
      }

      // Recording mode: hot-swap the active device via Rust
      const switchType = deviceType === 'Microphone' ? 'mic' : 'system';
      setSwitching(switchType);
      try {
        const ok = await invoke<boolean>('switch_audio_device', {
          deviceName,
          deviceType,
        });
        if (ok) {
          onDeviceSwitched(deviceName, deviceType);
        }
      } catch (err) {
        console.error('Failed to switch device:', err);
      } finally {
        setSwitching(null);
      }
    },
    [isRecording, onDeviceSwitched],
  );

  const truncate = (s: string | null, max: number) => {
    if (!s) return 'Predeterminado';
    return s.length > max ? s.slice(0, max) + '...' : s;
  };

  return (
    <>
      {/* Fullscreen backdrop: blocks clicks to content behind when dropdown is open */}
      {openDropdown !== null && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={() => setOpenDropdown(null)}
        />
      )}
    <div className="flex items-center gap-2 text-[10px] relative">
      {/* Mic selector */}
      <div className="relative">
        <button
          onClick={() => handleOpen('mic')}
          disabled={switching === 'mic'}
          className="flex items-center gap-1 px-2 py-1 rounded bg-[#485df4] hover:bg-[#3a4ed6] text-white transition-colors max-w-[140px] cursor-pointer select-none"
          title={currentMicDevice || 'Predeterminado'}
        >
          {switching === 'mic' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <span>🎤</span>
          )}
          <span className="truncate">{truncate(currentMicDevice, 16)}</span>
          <ChevronUp className="h-3 w-3 flex-shrink-0" />
        </button>
        {openDropdown === 'mic' && (
          <div className="absolute bottom-full left-0 mb-1 z-[60] bg-white dark:bg-gray-900 border border-border rounded-md shadow-lg py-1 min-w-[200px] max-h-[160px] overflow-y-auto">
            {inputDevices.length === 0 ? (
              <div className="px-3 py-2 text-muted-foreground">Sin dispositivos</div>
            ) : (
              inputDevices.map((d) => (
                <button
                  key={d.name}
                  onClick={() => handleSelect(d.name, 'Microphone')}
                  className={`w-full text-left px-3 py-1.5 hover:bg-accent transition-colors text-xs ${d.name === currentMicDevice ? 'bg-accent font-medium' : ''}`}
                >
                  {d.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* System selector */}
      <div className="relative">
        <button
          onClick={() => handleOpen('system')}
          disabled={switching === 'system'}
          className="flex items-center gap-1 px-2 py-1 rounded bg-[#10b981] hover:bg-[#0d9668] text-white transition-colors max-w-[140px] cursor-pointer select-none"
          title={currentSystemDevice || 'Predeterminado'}
        >
          {switching === 'system' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <span>🔊</span>
          )}
          <span className="truncate">{truncate(currentSystemDevice, 16)}</span>
          <ChevronUp className="h-3 w-3 flex-shrink-0" />
        </button>
        {openDropdown === 'system' && (
          <div className="absolute bottom-full left-0 mb-1 z-[60] bg-white dark:bg-gray-900 border border-border rounded-md shadow-lg py-1 min-w-[200px] max-h-[160px] overflow-y-auto">
            {outputDevices.length === 0 ? (
              <div className="px-3 py-2 text-muted-foreground">Sin dispositivos</div>
            ) : (
              outputDevices.map((d) => (
                <button
                  key={d.name}
                  onClick={() => handleSelect(d.name, 'SystemAudio')}
                  className={`w-full text-left px-3 py-1.5 hover:bg-accent transition-colors text-xs ${d.name === currentSystemDevice ? 'bg-accent font-medium' : ''}`}
                >
                  {d.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
