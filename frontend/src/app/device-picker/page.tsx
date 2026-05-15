'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface AudioDevice {
  name: string;
  device_type: 'Input' | 'Output' | string;
}

const GLASS_STYLE: React.CSSProperties = {
  background: 'rgba(15, 16, 24, 0.95)',
  backdropFilter: 'blur(22px) saturate(180%)',
  WebkitBackdropFilter: 'blur(22px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
};

/**
 * Mini-ventana popup que muestra la lista de dispositivos de audio (mic o
 * sis según `?type=mic|sys` en la URL). Click un device → invoca
 * `device_picker_select` que emite el evento global y cierra esta ventana.
 *
 * La ventana se cierra automáticamente al perder foco (configurado en Rust
 * vía on_window_event Focused(false)).
 */
export default function DevicePickerPage() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [loading, setLoading] = useState(true);
  // type: 'mic' (filtrar Input) | 'sys' (filtrar Output)
  const [pickerType, setPickerType] = useState<'mic' | 'sys'>('mic');

  useEffect(() => {
    // Leer ?type=mic|sys de la URL
    const params = new URLSearchParams(window.location.search);
    const t = params.get('type');
    if (t === 'sys') setPickerType('sys');
    else setPickerType('mic');
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<AudioDevice[]>('get_audio_devices')
      .then((list) => {
        if (!cancelled) {
          setDevices(list);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error('device-picker: get_audio_devices failed', e);
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = devices.filter(d =>
    pickerType === 'mic' ? d.device_type === 'Input' : d.device_type === 'Output'
  );

  const handleSelect = async (deviceName: string) => {
    try {
      await invoke('device_picker_select', {
        deviceName,
        deviceType: pickerType === 'mic' ? 'Microphone' : 'SystemAudio',
      });
    } catch (e) {
      console.error('device-picker: select failed', e);
    }
  };

  const title = pickerType === 'mic' ? 'Micrófono' : 'Audio del sistema';

  return (
    <div
      className="h-screen w-screen flex flex-col rounded-xl overflow-hidden text-white"
      style={GLASS_STYLE}
    >
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-white/50 border-b border-white/10 font-semibold">
        {title}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="px-3 py-3 text-[11px] text-white/50">Cargando...</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-white/50">Sin dispositivos</div>
        )}
        {!loading && filtered.map((d) => (
          <button
            key={d.name}
            onClick={() => handleSelect(d.name)}
            className="block w-full text-left px-3 py-1.5 text-[11px] text-white/85 hover:bg-white/10 transition-colors truncate"
            title={d.name}
          >
            {d.name}
          </button>
        ))}
      </div>
    </div>
  );
}
