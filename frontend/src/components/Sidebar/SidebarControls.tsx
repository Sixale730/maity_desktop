'use client';

import React from 'react';
import { Settings, Mic, Square } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Info from '@/components/shared/Info';

interface SidebarControlsProps {
  isRecording: boolean;
  isCollapsed: boolean;
  onRecordingToggle: () => void;
}

export const SidebarControls: React.FC<SidebarControlsProps> = ({
  isRecording,
  isCollapsed,
  onRecordingToggle,
}) => {
  const router = useRouter();

  if (isCollapsed) return null;

  return (
    <div className="flex-shrink-0 p-2 border-t border-gray-100 dark:border-gray-700">
      <button
        onClick={onRecordingToggle}
        disabled={isRecording}
        aria-label={isRecording ? 'Grabación en progreso' : 'Iniciar grabación'}
        className={`w-full flex items-center justify-center px-3 py-2 text-sm font-medium text-white ${isRecording ? 'bg-[#ff80ad] cursor-not-allowed' : 'bg-[#ff0050] hover:bg-[#cc0040]'} rounded-lg transition-colors shadow-sm`}
      >
        {isRecording ? (
          <>
            <Square className="w-4 h-4 mr-2" />
            <span>Grabación en progreso...</span>
          </>
        ) : (
          <>
            <Mic className="w-4 h-4 mr-2" />
            <span>Iniciar Grabación</span>
          </>
        )}
      </button>

      <button
        onClick={() => router.push('/settings')}
        aria-label="Abrir configuración"
        className="w-full flex items-center justify-center px-3 py-1.5 mt-1 mb-1 text-sm font-medium text-[#3a3a3c] dark:text-gray-200 bg-[#d0d0d3] dark:bg-gray-700 hover:bg-[#b0b0b3] dark:hover:bg-gray-600 rounded-lg transition-colors shadow-sm"
      >
        <Settings className="w-4 h-4 mr-2" />
        <span>Configuración</span>
      </button>
      <Info isCollapsed={isCollapsed} />
      <div className="w-full flex items-center justify-center px-3 py-1 text-xs text-[#8a8a8d] dark:text-gray-500">
        v0.2.0
      </div>
    </div>
  );
};
