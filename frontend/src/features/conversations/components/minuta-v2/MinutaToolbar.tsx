'use client';

import { useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { MeetingMinutesDataV2 } from '@/features/conversations/services/conversations.service';

interface MinutaToolbarProps {
  minuta: MeetingMinutesDataV2;
  /** Optional regenerate handler. When omitted, the regenerate button is hidden. */
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}

export function MinutaToolbar({ minuta, onRegenerate, isRegenerating }: MinutaToolbarProps) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const [{ pdf }, { MinutaPdfDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/features/conversations/utils/minuta-pdf'),
      ]);
      const blob = await pdf(<MinutaPdfDocument minuta={minuta} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sanitizeFilename(minuta.meta.titulo)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[MinutaToolbar] PDF download failed:', err);
      toast.error('No se pudo generar el PDF');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-2 justify-end">
      <Button
        variant="outline"
        size="sm"
        onClick={handleDownload}
        disabled={downloading}
        className="border-white/10 text-gray-300 hover:bg-white/5"
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Download className="h-4 w-4 mr-2" />
        )}
        Descargar PDF
      </Button>
      {onRegenerate && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRegenerating ? 'animate-spin' : ''}`} />
          Regenerar minuta
        </Button>
      )}
    </div>
  );
}

function sanitizeFilename(s: string): string {
  return (
    s
      .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'minuta'
  );
}
