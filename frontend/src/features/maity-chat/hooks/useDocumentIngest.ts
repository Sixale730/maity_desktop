import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { extractDocument, DocumentExtractError } from '../utils/extractDocument';

/** Un documento adjuntado al composer, extraído a texto del lado del cliente. */
export interface ComposerAttachment {
  filename: string;
  text: string;
}

/** Máximo de adjuntos por turno (igual que el web). */
export const MAX_ATTACHMENTS = 3;

/**
 * Ingesta compartida de documentos para el composer del chat — usada tanto por
 * el botón de clip como por el drag-and-drop sobre el área del chat. Encapsula
 * el flujo extraer → validar → tope → toast para que ningún call site lo duplique.
 *
 * Acepta N archivos (un drop puede traer varios), extrae cada uno vía
 * `extractDocument`, se detiene en MAX_ATTACHMENTS, mapea los códigos de
 * DocumentExtractError a los toasts `chat.attachment_error.*` ya existentes, y
 * hace un único setState al final.
 */
export function useDocumentIngest(
  attachments: ComposerAttachment[],
  onAttachmentsChange: (next: ComposerAttachment[]) => void,
) {
  const { t } = useLanguage();
  const [extracting, setExtracting] = useState(false);

  const ingestFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (attachments.length >= MAX_ATTACHMENTS) {
        toast.error(t('chat.attachment_max'));
        return;
      }

      setExtracting(true);
      let next = attachments;
      let added = false;
      try {
        for (const file of files) {
          if (next.length >= MAX_ATTACHMENTS) {
            toast.error(t('chat.attachment_max'));
            break;
          }
          try {
            const { filename, text } = await extractDocument(file);
            next = [...next, { filename, text }];
            added = true;
          } catch (err) {
            const code = err instanceof DocumentExtractError ? err.code : 'failed';
            toast.error(t(`chat.attachment_error.${code}`));
          }
        }
        if (added) onAttachmentsChange(next);
      } finally {
        setExtracting(false);
      }
    },
    [attachments, onAttachmentsChange, t],
  );

  return { extracting, ingestFiles };
}
