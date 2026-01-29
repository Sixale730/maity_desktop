import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Info } from 'lucide-react';
import type { BackendInfo } from '@/types/audio';

export type { BackendInfo };

interface AudioBackendSelectorProps {
  currentBackend?: string;
  onBackendChange?: (backend: string) => void;
  disabled?: boolean;
}

export function AudioBackendSelector({
  currentBackend: propBackend,
  onBackendChange,
  disabled = false,
}: AudioBackendSelectorProps) {
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [currentBackend, setCurrentBackend] = useState<string>('coreaudio');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  // Load available backends and current selection
  useEffect(() => {
    const loadBackends = async () => {
      try {
        setLoading(true);
        setError(null);

        // Get backend info (includes name and description)
        const backendInfo = await invoke<BackendInfo[]>('get_audio_backend_info');
        setBackends(backendInfo);

        // Get current backend if not provided via props
        if (!propBackend) {
          const current = await invoke<string>('get_current_audio_backend');
          setCurrentBackend(current);
        } else {
          setCurrentBackend(propBackend);
        }
      } catch (err) {
        console.error('Failed to load audio backends:', err);
        setError('Failed to load backend options');
      } finally {
        setLoading(false);
      }
    };

    loadBackends();
  }, [propBackend]);

  // Handle backend selection
  const handleBackendChange = async (backendId: string) => {
    try {
      setError(null);
      await invoke('set_audio_backend', { backend: backendId });
      setCurrentBackend(backendId);

      // Notify parent component
      if (onBackendChange) {
        onBackendChange(backendId);
      }

      console.log(`Audio backend changed to: ${backendId}`);
    } catch (err) {
      console.error('Failed to set audio backend:', err);
      setError('Failed to change backend. Please try again.');
    }
  };

  // Only show selector if there are multiple backends
  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-[#d0d0d3] dark:bg-gray-600 rounded w-32 mb-2"></div>
        <div className="h-10 bg-[#d0d0d3] dark:bg-gray-600 rounded"></div>
      </div>
    );
  }

  // Hide if only one backend available
  if (backends.length <= 1) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">
          System Audio Backend
        </label>
        <div className="relative">
          <button
            type="button"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            className="text-[#8a8a8d] dark:text-gray-500 hover:text-[#4a4a4c] dark:hover:text-gray-300 transition-colors"
          >
            <Info className="h-4 w-4" />
          </button>
          {showTooltip && (
            <div className="absolute z-10 left-6 top-0 w-64 p-3 text-xs bg-[#000000] text-white rounded-lg shadow-lg">
              <p className="font-semibold mb-1">Audio Capture Methods:</p>
              <ul className="space-y-1">
                {backends.map((backend) => (
                  <li key={backend.id}>
                    <span className="font-medium">{backend.name}:</span> {backend.description}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-gray-300">
                Try different backends to find which works best for your system.
              </p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="p-2 text-xs text-[#990030] bg-[#fff0f5] border border-[#ffc0d6] rounded-md">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {backends.map((backend) => {
          // Disable Core Audio option
          const isCoreAudio = backend.id === 'screencapturekit';
          const isDisabled = disabled || isCoreAudio;

          return (
            <label
              key={backend.id}
              className={`flex items-start p-3 border rounded-lg transition-all ${
                currentBackend === backend.id
                  ? 'border-[#485df4] bg-[#f0f2fe] dark:bg-blue-900/30'
                  : 'border-[#d0d0d3] dark:border-gray-600 hover:border-gray-400 bg-white dark:bg-gray-800'
              } ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <input
                type="radio"
                name="audioBackend"
                value={backend.id}
                checked={currentBackend === backend.id}
                onChange={() => handleBackendChange(backend.id)}
                disabled={isDisabled}
                className="mt-1 h-4 w-4 text-[#3a4ac3] focus:ring-[#485df4] border-[#d0d0d3]"
              />
              <div className="ml-3 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[#000000] dark:text-white">
                    {backend.name}
                  </span>
                  {currentBackend === backend.id && (
                    <span className="text-xs font-medium text-[#3a4ac3] bg-[#e0e5fd] px-2 py-0.5 rounded">
                      Active
                    </span>
                  )}
                  {isCoreAudio && (
                    <span className="text-xs font-medium text-[#6a6a6d] dark:text-gray-400 bg-[#e7e7e9] dark:bg-gray-700 px-2 py-0.5 rounded">
                      Disabled
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-[#4a4a4c] dark:text-gray-300">{backend.description}</p>
              </div>
            </label>
          );
        })}
      </div>

      <div className="text-xs text-[#6a6a6d] dark:text-gray-400 space-y-1">
        <p>• Backend selection only affects system audio capture</p>
        <p>• Microphone always uses the default method</p>
        <p>• Changes apply to new recording sessions</p>
      </div>
    </div>
  );
}