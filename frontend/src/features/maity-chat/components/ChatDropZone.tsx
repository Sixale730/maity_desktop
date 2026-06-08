import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface ChatDropZoneProps {
  /** Entrega los archivos soltados a la ingesta compartida (extraer + validar). */
  onFiles: (files: File[]) => void;
  children: ReactNode;
}

/** True cuando un arrastre nativo trae archivos (vs. arrastres de texto/elementos). */
function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Target de drag-and-drop de área completa para el chat. Envuelve la
 * conversación + composer; soltar un archivo en cualquier parte sobre él
 * adjunta el documento, espejando el botón de clip. Muestra un overlay
 * punteado mientras hay un arrastre de archivo activo.
 *
 * El wrapper en sí no scrollea (sus hijos manejan su propio scroll), así que su
 * altura es igual al área visible y el overlay `absolute inset-0` cubre
 * exactamente el panel del chat. Un contador de profundidad evita el parpadeo a
 * medida que el puntero pasa sobre los hijos (cada hijo dispara su propio
 * dragenter/dragleave).
 */
export function ChatDropZone({ onFiles, children }: ChatDropZoneProps) {
  const { t } = useLanguage();
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  // Evita que el browser navegue a / abra un archivo soltado justo fuera de la
  // zona (p.ej. sobre el sidebar), lo que volaría la SPA.
  useEffect(() => {
    const prevent = (e: globalThis.DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  };

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // requerido para que dispare el evento drop
  };

  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };

  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  };

  return (
    <div
      className="relative flex-1 min-h-0 flex flex-col"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}

      {dragging && (
        <div
          className="absolute inset-0 z-30 grid place-items-center pointer-events-none"
          style={{ background: 'rgba(72,93,244,0.10)', backdropFilter: 'blur(2px)' }}
        >
          <div
            className="flex flex-col items-center gap-3 rounded-2xl px-8 py-7"
            style={{
              border: '2px dashed rgba(72,93,244,0.6)',
              background: 'rgba(20,20,28,0.7)',
            }}
          >
            <FilePlus2 size={28} strokeWidth={1.7} className="text-maity-blue" />
            <span className="text-foreground font-medium" style={{ fontSize: 14 }}>
              {t('chat.drop_hint')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
