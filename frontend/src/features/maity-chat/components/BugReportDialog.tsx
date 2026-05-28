import { useState } from 'react';
import { Bug } from 'lucide-react';
import { toast } from 'sonner';
import { ChatTelemetryService, type BugCategory } from '@maity/shared';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  /** Active thread id, attached as context when "include context" is checked. */
  threadId?: string | null;
}

const CATEGORIES: BugCategory[] = ['bug', 'idea', 'confusing', 'other'];

/**
 * Diálogo "Reportar un problema" dentro del chat. Persiste en
 * maity.chat_bug_reports vía la RPC submit_chat_bug_report (sin endpoint
 * Vercel). source='manual'.
 *
 * Port del web (Sixale730/maity) con adapters del desktop:
 *  - primitives UI desde @/components/ui/* (no @/ui/components/ui/*)
 *  - checkbox nativo (el desktop no tiene primitive Checkbox)
 *  - app_version vía getVersion() de Tauri (el web usa import.meta.env)
 */
export function BugReportDialog({ threadId }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<BugCategory>('bug');
  const [description, setDescription] = useState('');
  const [includeContext, setIncludeContext] = useState(true);
  const [sending, setSending] = useState(false);

  const reset = () => {
    setCategory('bug');
    setDescription('');
    setIncludeContext(true);
  };

  const handleSubmit = async () => {
    const text = description.trim();
    if (!text) {
      toast.error(t('chat.report.empty'));
      return;
    }
    setSending(true);
    try {
      // Versión real de la app de escritorio (Tauri). Fallback a null si la
      // API no está disponible (ej. en dev fuera del contenedor Tauri).
      let appVersion: string | null = null;
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        appVersion = await getVersion();
      } catch {
        appVersion = null;
      }

      await ChatTelemetryService.submitBugReport({
        category,
        description: text,
        threadId: includeContext ? threadId ?? null : null,
        context: {
          user_agent: navigator.userAgent,
          url: window.location.pathname,
          app_version: appVersion,
          included_thread: includeContext && !!threadId,
        },
      });
      toast.success(t('chat.report.success'));
      reset();
      setOpen(false);
    } catch {
      toast.error(t('chat.report.error'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-card border border-border text-foreground hover:bg-card-hi transition-colors"
          aria-label={t('chat.report.button')}
          title={t('chat.report.button')}
        >
          <Bug size={14} strokeWidth={1.8} />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('chat.report.title')}</DialogTitle>
          <DialogDescription>{t('chat.report.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t('chat.report.category')}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as BugCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`chat.report.category.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bug-detail">{t('chat.report.detail')}</Label>
            <Textarea
              id="bug-detail"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('chat.report.placeholder')}
              rows={5}
              maxLength={2000}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="bug-context"
              type="checkbox"
              checked={includeContext}
              onChange={(e) => setIncludeContext(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-maity-blue cursor-pointer"
            />
            <Label htmlFor="bug-context" className="text-sm font-normal cursor-pointer">
              {t('chat.report.include_context')}
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={sending || !description.trim()}>
            {sending ? t('chat.report.sending') : t('chat.report.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
