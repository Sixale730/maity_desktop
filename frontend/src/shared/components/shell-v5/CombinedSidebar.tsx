import { ReactNode } from 'react';
import { Bell, Plus, Search } from 'lucide-react';
import { MaityLogo } from '@/shared/components/MaityLogo';
import { useLanguage } from '@/contexts/LanguageContext';
import { SidebarFooterV5 } from './SidebarFooterV5';

interface CombinedSidebarProps {
  /** "+ Nueva sesión" handler. */
  onNewSession: () => void;
  isCreating?: boolean;
  /** Slot for the conversations list. The chat feature owns it and renders
   *  <ActiveEntryItem>s inside. */
  todayEntriesSlot: ReactNode;
  onSearchClick?: () => void;
  onNotificationsClick?: () => void;
}

/**
 * Sidebar minimal del desktop (296px). Versión simplificada del CombinedSidebar
 * de la web: sin ZoneSwitcher, sin WeeklyCalendar, sin urgency legend, sin
 * NavItem "Mis Conversaciones" (el sidebar entero ES la lista).
 *
 * Estructura (top → bottom):
 *  1. Brand row — logo + "maity" + search + bell
 *  2. "+ Nueva sesión" — full-width gradient
 *  3. Conversations list (slot) — flex 1
 *  4. SidebarFooterV5 — avatar + menú usuario
 */
export function CombinedSidebar({
  onNewSession,
  isCreating,
  todayEntriesSlot,
  onSearchClick,
  onNotificationsClick,
}: CombinedSidebarProps) {
  const { t } = useLanguage();

  return (
    <aside
      className="flex-shrink-0 h-screen bg-background border-r border-border flex flex-col"
      style={{ width: 296 }}
    >
      {/* 1 · Brand row */}
      <div className="flex items-center gap-2" style={{ padding: '14px 14px 10px' }}>
        <MaityLogo variant="symbol" size="sm" className="!h-[22px] !min-w-0" />
        <span
          className="font-geist font-semibold text-foreground"
          style={{ fontSize: 19, letterSpacing: '-0.6px', lineHeight: 1 }}
        >
          maity
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onSearchClick}
          className="w-7 h-7 rounded-md grid place-items-center text-foreground/40 hover:text-foreground hover:bg-card/40 transition-colors"
          title={t('chat.search')}
          aria-label={t('chat.search')}
        >
          <Search size={13} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onNotificationsClick}
          className="w-7 h-7 rounded-md grid place-items-center text-foreground/40 hover:text-foreground hover:bg-card/40 transition-colors"
          title={t('chat.notifications')}
          aria-label={t('chat.notifications')}
        >
          <Bell size={13} strokeWidth={1.8} />
        </button>
      </div>

      {/* 2 · "+ Nueva sesión" full-width gradient */}
      <button
        type="button"
        onClick={onNewSession}
        disabled={isCreating}
        className="flex items-center justify-center gap-2 text-white font-semibold disabled:opacity-50 transition-opacity"
        style={{
          margin: '12px 12px 10px',
          padding: '10px 12px',
          borderRadius: 10,
          background: 'linear-gradient(135deg, hsl(var(--maity-blue)), hsl(var(--maity-blue) / 0.85))',
          boxShadow: '0 4px 14px hsl(var(--maity-blue) / 0.35)',
          fontSize: 13,
        }}
      >
        <Plus size={16} strokeWidth={2.2} />
        {t('chat.new_session')}
      </button>

      {/* 3 · Conversations list slot (flex 1) */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {todayEntriesSlot}
      </div>

      {/* 4 · Footer — avatar + user menu */}
      <SidebarFooterV5 />
    </aside>
  );
}
