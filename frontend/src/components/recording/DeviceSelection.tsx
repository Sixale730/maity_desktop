import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { RefreshCw, Mic, Speaker } from 'lucide-react';
import { usePlatform } from '@/hooks/usePlatform';
import { AudioLevelMeter, CompactAudioLevelMeter } from '@/components/recording/AudioLevelMeter';
import { AudioBackendSelector } from '@/components/recording/AudioBackendSelector';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import Analytics from '@/lib/analytics';
import type { AudioDevice, SelectedDevices, AudioLevelData, AudioLevelUpdate } from '@/types/audio';

export type { AudioDevice, SelectedDevices, AudioLevelData, AudioLevelUpdate };

interface DeviceSelectionProps {
  selectedDevices: SelectedDevices;
  onDeviceChange: (devices: SelectedDevices) => void;
  disabled?: boolean;
}

export function DeviceSelection({ selectedDevices, onDeviceChange, disabled = false }: DeviceSelectionProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [audioLevels, setAudioLevels] = useState<Map<string, AudioLevelData>>(new Map());
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [showLevels, setShowLevels] = useState(false);
  const platformName = usePlatform();
  const isWindows = platformName === 'windows';

  // Filter devices by type
  const inputDevices = devices.filter(device => device.device_type === 'Input');
  const outputDevices = devices.filter(device => device.device_type === 'Output');

  // Get default output device name for Windows display
  const defaultOutputDevice = outputDevices.length > 0 ? outputDevices[0]?.name : 'Default System Audio';

  // Handle platform-specific defaults
  useEffect(() => {
    // On Windows, force system device to null (use default)
    if (isWindows && selectedDevices.systemDevice !== null) {
      onDeviceChange({
        ...selectedDevices,
        systemDevice: null
      });
    }
  }, [isWindows]);

  // Fetch available audio devices
  const fetchDevices = async () => {
    try {
      setError(null);
      const result = await invoke<AudioDevice[]>('get_audio_devices');
      setDevices(result);
      console.log('Fetched audio devices:', result);
    } catch (err) {
      console.error('Failed to fetch audio devices:', err);
      setError('Error al cargar dispositivos de audio. Por favor verifica la configuración de audio de tu sistema.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Load devices on component mount
  useEffect(() => {
    fetchDevices();
  }, []);

  // Set up audio level event listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupAudioLevelListener = async () => {
      try {
        unlisten = await listen<AudioLevelUpdate>('audio-levels', (event) => {
          const levelUpdate = event.payload;
          const newLevels = new Map<string, AudioLevelData>();

          levelUpdate.levels.forEach(level => {
            newLevels.set(level.device_name, level);
          });

          setAudioLevels(newLevels);
        });
      } catch (err) {
        console.error('Failed to setup audio level listener:', err);
      }
    };

    setupAudioLevelListener();

    // Cleanup function
    return () => {
      if (unlisten) {
        unlisten();
      }
      // Stop monitoring when component unmounts
      if (isMonitoring) {
        stopAudioLevelMonitoring();
      }
    };
  }, [isMonitoring]);

  // Handle device refresh
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchDevices();
  };

  // Helper function to detect device category and Bluetooth status
  const getDeviceMetadata = (deviceName: string) => {
    const nameLower = deviceName.toLowerCase();

    // Detect if it's Bluetooth
    const isBluetooth = nameLower.includes('airpods')
      || nameLower.includes('bluetooth')
      || nameLower.includes('wireless')
      || nameLower.includes('wh-')  // Sony WH-* series
      || nameLower.includes('bt ');

    // Categorize device
    let category = 'wired';
    if (deviceName === 'default') {
      category = 'default';
    } else if (nameLower.includes('airpods')) {
      category = 'airpods';
    } else if (isBluetooth) {
      category = 'bluetooth';
    }

    return { isBluetooth, category };
  };

  // Handle microphone device selection
  const handleMicDeviceChange = (deviceName: string) => {
    const newDevices = {
      ...selectedDevices,
      micDevice: deviceName === 'default' ? null : deviceName
    };
    onDeviceChange(newDevices);

    // Track device selection analytics with enhanced metadata
    const metadata = getDeviceMetadata(deviceName);
    Analytics.track('microphone_selected', {
      device_name: deviceName,
      device_category: metadata.category,
      is_bluetooth: metadata.isBluetooth.toString(),
      has_system_audio: (!!selectedDevices.systemDevice).toString()
    }).catch(err => console.error('Failed to track microphone selection:', err));
  };

  // Handle system audio device selection
  const handleSystemDeviceChange = (deviceName: string) => {
    const newDevices = {
      ...selectedDevices,
      systemDevice: deviceName === 'default' ? null : deviceName
    };
    onDeviceChange(newDevices);

    // Track device selection analytics with enhanced metadata
    const metadata = getDeviceMetadata(deviceName);
    Analytics.track('system_audio_selected', {
      device_name: deviceName,
      device_category: metadata.category,
      is_bluetooth: metadata.isBluetooth.toString(),
      has_microphone: (!!selectedDevices.micDevice).toString()
    }).catch(err => console.error('Failed to track system audio selection:', err));
  };

  // Start audio level monitoring
  const startAudioLevelMonitoring = async () => {
    try {
      // Only monitor input devices for now (microphones)
      const deviceNames = inputDevices.map(device => device.name);
      if (deviceNames.length === 0) {
        setError('No se encontraron dispositivos de micrófono para monitorear');
        return;
      }

      await invoke('start_audio_level_monitoring', { deviceNames });
      setIsMonitoring(true);
      setShowLevels(true);
      console.log('Started audio level monitoring for input devices:', deviceNames);
    } catch (err) {
      console.error('Failed to start audio level monitoring:', err);
      setError('Error al iniciar monitoreo de nivel de audio');
    }
  };

  // Stop audio level monitoring
  const stopAudioLevelMonitoring = async () => {
    try {
      await invoke('stop_audio_level_monitoring');
      setIsMonitoring(false);
      setAudioLevels(new Map());
      console.log('Stopped audio level monitoring');
    } catch (err) {
      console.error('Failed to stop audio level monitoring:', err);
    }
  };

  // Toggle audio level monitoring
  const toggleAudioLevelMonitoring = async () => {
    if (isMonitoring) {
      await stopAudioLevelMonitoring();
    } else {
      await startAudioLevelMonitoring();
    }
  };

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="animate-pulse">
          <div className="h-4 bg-[#d0d0d3] dark:bg-gray-600 rounded w-1/3 mb-4"></div>
          <div className="h-10 bg-[#d0d0d3] dark:bg-gray-600 rounded mb-3"></div>
          <div className="h-10 bg-[#d0d0d3] dark:bg-gray-600 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-[#000000] dark:text-white">Dispositivos de Audio</h4>
        <div className="flex items-center space-x-2">
          {/* TODO: Monitoring */}
          {/* <button */}
          {/*   onClick={toggleAudioLevelMonitoring} */}
          {/*   disabled={disabled || inputDevices.length === 0} */}
          {/*   className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${ */}
          {/*     isMonitoring */}
          {/*       ? 'bg-[#ffe0eb] text-[#990030] hover:bg-red-200' */}
          {/*       : 'bg-[#c5fceb] text-[#108c5c] hover:bg-green-200' */}
          {/*   } disabled:pointer-events-none disabled:opacity-50`} */}
          {/*   title={inputDevices.length === 0 ? 'No microphones available to test' : ''} */}
          {/* > */}
          {/*   {isMonitoring ? 'Stop Test' : 'Test Mic'} */}
          {/* </button> */}
          <button
            onClick={handleRefresh}
            disabled={refreshing || disabled}
            className="h-8 w-8 p-0 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-[#e7e7e9] dark:hover:bg-gray-700 disabled:pointer-events-none disabled:opacity-50 dark:text-gray-300"
            aria-label="Actualizar dispositivos de audio"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 text-sm text-[#990030] dark:text-red-400 bg-[#fff0f5] dark:bg-red-900/30 border border-[#ffc0d6] dark:border-red-700 rounded-md">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {/* Microphone Selection */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-[#4a4a4c] dark:text-gray-300" />
            <Label htmlFor="mic-selection" className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">
              Micrófono
            </Label>
          </div>
          <Select
            value={selectedDevices.micDevice || 'default'}
            onValueChange={handleMicDeviceChange}
            disabled={disabled}
          >
            <SelectTrigger id="mic-selection" className="w-full">
              <SelectValue placeholder="Seleccionar Micrófono" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Micrófono Predeterminado</SelectItem>
              {inputDevices.map((device) => (
                <SelectItem
                  key={device.name}
                  value={`${device.name} (${device.device_type.toLowerCase()})`}
                >
                  {device.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {inputDevices.length === 0 && (
            <p className="text-xs text-[#6a6a6d] dark:text-gray-400">No se encontraron dispositivos de micrófono</p>
          )}

          {/* Audio Level Meters for Input Devices */}
          {showLevels && inputDevices.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <p className="text-xs text-[#4a4a4c] dark:text-gray-300 font-medium">Niveles del Micrófono:</p>
              {inputDevices.map((device) => {
                const levelData = audioLevels.get(device.name);
                return (
                  <div key={`level-${device.name}`} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#4a4a4c] dark:text-gray-300 truncate max-w-[200px]">
                        {device.name}
                      </span>
                      {levelData && (
                        <CompactAudioLevelMeter
                          rmsLevel={levelData.rms_level}
                          peakLevel={levelData.peak_level}
                          isActive={levelData.is_active}
                        />
                      )}
                    </div>
                    {levelData && (
                      <AudioLevelMeter
                        rmsLevel={levelData.rms_level}
                        peakLevel={levelData.peak_level}
                        isActive={levelData.is_active}
                        deviceName={device.name}
                        size="small"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* System Audio Selection */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Speaker className="h-4 w-4 text-[#4a4a4c] dark:text-gray-300" />
            <Label htmlFor="system-selection" className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">
              Audio del Sistema
            </Label>
          </div>

          <Select
            value={selectedDevices.systemDevice || 'default'}
            onValueChange={handleSystemDeviceChange}
            disabled={disabled}
          >
            <SelectTrigger id="system-selection" className="w-full">
              <SelectValue placeholder="Seleccionar Audio del Sistema" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Audio del Sistema Predeterminado</SelectItem>
              {outputDevices.map((device) => (
                <SelectItem
                  key={device.name}
                  value={`${device.name} (${device.device_type.toLowerCase()})`}
                >
                  {device.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {outputDevices.length === 0 && (
            <p className="text-xs text-[#6a6a6d] dark:text-gray-400">No se encontraron dispositivos de audio del sistema</p>
          )}

          {/* Backend Selection - available on all platforms */}
          {!disabled && (
            <div className="pt-3 border-t border-gray-100">
              <AudioBackendSelector disabled={disabled} />
            </div>
          )}
        </div>
      </div>

      {/* Info text */}
      <div className="text-xs text-[#6a6a6d] dark:text-gray-400 space-y-1">
        <p>• <strong>Micrófono:</strong> Graba tu voz y sonido ambiente</p>
        <p>• <strong>Audio del Sistema:</strong> Graba audio de la computadora (música, llamadas, etc.)</p>
        {isMonitoring && (
          <p>• <strong>Niveles del Mic:</strong> Verde = bueno, Amarillo = alto, Rojo = muy alto</p>
        )}
        {!isMonitoring && inputDevices.length > 0 && (
          <p>• <strong>Tip:</strong> Haz clic en "Probar Mic" para verificar si tu micrófono funciona</p>
        )}
      </div>
    </div>
  );
}
