"use client";

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, FolderOpen, Download } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import Analytics from '@/lib/analytics';
import { useState } from 'react';


interface TranscriptButtonGroupProps {
  transcriptCount: number;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  meetingId?: string;
}


export function TranscriptButtonGroup({
  transcriptCount,
  onCopyTranscript,
  onOpenMeetingFolder,
  meetingId
}: TranscriptButtonGroupProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const handleExport = async (format: 'json' | 'csv' | 'markdown' | 'pdf') => {
    if (!meetingId) {
      console.error('Meeting ID not available');
      return;
    }

    try {
      setIsExporting(true);
      await invoke('export_meeting', {
        meeting_id: meetingId,
        format: format,
      });
      Analytics.trackButtonClick(`export_${format}`, 'meeting_details');
    } catch (error) {
      console.error(`Export failed: ${error}`);
      alert(`Export failed: ${error}`);
    } finally {
      setIsExporting(false);
      setExportMenuOpen(false);
    }
  };

  return (
    <div className="flex items-center justify-center w-full gap-2">
      <ButtonGroup>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            Analytics.trackButtonClick('copy_transcript', 'meeting_details');
            onCopyTranscript();
          }}
          disabled={transcriptCount === 0}
          title={transcriptCount === 0 ? 'No hay transcripción disponible' : 'Copiar Transcripción'}
        >
          <Copy />
          <span className="hidden lg:inline">Copiar</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="xl:px-4"
          onClick={() => {
            Analytics.trackButtonClick('open_recording_folder', 'meeting_details');
            onOpenMeetingFolder();
          }}
          title="Abrir Carpeta de Grabaciones"
        >
          <FolderOpen className="xl:mr-2" size={18} />
          <span className="hidden lg:inline">Grabación</span>
        </Button>

        {/* Export dropdown button */}
        <div className="relative">
          <Button
            size="sm"
            variant="outline"
            className="xl:px-4"
            onClick={() => setExportMenuOpen(!exportMenuOpen)}
            disabled={transcriptCount === 0 || isExporting}
            title={transcriptCount === 0 ? 'No hay transcripción disponible' : 'Exportar Reunión'}
          >
            <Download className="xl:mr-2" size={18} />
            <span className="hidden lg:inline">Exportar</span>
          </Button>

          {/* Export submenu */}
          {exportMenuOpen && (
            <div className="absolute right-0 mt-1 w-32 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50">
              <button
                onClick={() => handleExport('json')}
                disabled={isExporting}
                className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                JSON
              </button>
              <button
                onClick={() => handleExport('csv')}
                disabled={isExporting}
                className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                CSV
              </button>
              <button
                onClick={() => handleExport('markdown')}
                disabled={isExporting}
                className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Markdown
              </button>
              <button
                onClick={() => handleExport('pdf')}
                disabled={isExporting}
                className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                PDF
              </button>
            </div>
          )}
        </div>
      </ButtonGroup>
    </div>
  );
}
