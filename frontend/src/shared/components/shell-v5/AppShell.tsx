import { ReactNode } from 'react';

interface AppShellProps {
  /** Slot for the contextual sidebar (typically <CombinedSidebar />). */
  sidebar: ReactNode;
  /** Slot for the screen's TopBar. Optional. */
  topBar?: ReactNode;
  /** Main content (empty state or active conversation + composer). */
  children: ReactNode;
}

/**
 * Shell del chat (desktop variant) — 2 columnas: sidebar (296px) + main.
 *
 * Vive ADENTRO del `<MainContent>` del desktop (layout.tsx), que ya rendereo
 * el outer `<Sidebar />` global del desktop a la izquierda. Por eso usamos
 * `h-full w-full` (relativo a su contenedor) en vez de `h-screen w-full` —
 * de otra forma encimaría el outer Sidebar.
 *
 *  ┌──────┬──────────┬──────────────────────────────────────┐
 *  │ outer│ sidebar  │  topBar                              │
 *  │ Side-│ chat v5  │  ──────────────────────────────────  │
 *  │ bar  │ (296px)  │  main scrollable                     │
 *  │ del  │          │   ChatEmpty / ChatConversation       │
 *  │ desk-│          │   Composer (sticky bottom)           │
 *  │ top  │          │   + MemoriesOverlay (overlay)        │
 *  └──────┴──────────┴──────────────────────────────────────┘
 */
export function AppShell({
  sidebar,
  topBar,
  children,
}: AppShellProps) {
  return (
    <div className="h-full w-full flex bg-background text-foreground font-inter overflow-hidden">
      {sidebar}
      <main className="flex-1 min-w-0 flex flex-col">
        {topBar}
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </main>
    </div>
  );
}
