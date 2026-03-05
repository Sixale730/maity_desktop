'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, Loader2 } from 'lucide-react';
import type { AudioDevice } from '@/types/audio';

interface InlineDeviceSelectorProps {
  currentMicDevice: string | null;
  currentSystemDevice: string | null;
  onDeviceSwitched: (deviceName: string, deviceType: 'Microphone' | 'SystemAudio') => void;
}

export function InlineDeviceSelector({
  currentMicDevice,
  currentSystemDevice,
  onDeviceSwitched,
}: InlineDeviceSelectorProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [openDropdown, setOpenDropdown] = useState<'mic' | 'system' | null>(null);
  const [switching, setSwitching] = useState<'mic' | 'system' | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    [onDeviceSwitched],
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const truncate = (s: string | null, max: number) => {
    if (!s) return 'Predeterminado';
    return s.length > max ? s.slice(0, max) + '...' : s;
  };

  return (
    <div ref={dropdownRef} className="flex items-center gap-2 text-[10px] relative">
      {/* Mic selector */}
      <div className="relative">
        <button
          onClick={() => handleOpen('mic')}
          disabled={switching === 'mic'}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#485df4]/10 hover:bg-[#485df4]/20 text-[#485df4] transition-colors max-w-[140px]"
          title={currentMicDevice || 'Predeterminado'}
        >
          {switching === 'mic' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <span>🎤</span>
          )}
          <span className="truncate">{truncate(currentMicDevice, 16)}</span>
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        </button>
        {openDropdown === 'mic' && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[200px] max-h-[200px] overflow-y-auto">
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
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#10b981]/10 hover:bg-[#10b981]/20 text-[#10b981] transition-colors max-w-[140px]"
          title={currentSystemDevice || 'Predeterminado'}
        >
          {switching === 'system' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <span>🔊</span>
          )}
          <span className="truncate">{truncate(currentSystemDevice, 16)}</span>
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        </button>
        {openDropdown === 'system' && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[200px] max-h-[200px] overflow-y-auto">
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
  );
}
