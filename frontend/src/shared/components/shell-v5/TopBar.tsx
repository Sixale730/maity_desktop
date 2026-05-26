import { ReactNode } from 'react';
import { Dot } from './Dot';

interface TopBarProps {
  breadcrumb?: string;
  /** Hex color for the small dot beside the title (urgency signal). */
  accentDot?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/**
 * Shell v5 top bar — 68px fixed height. v5 keeps the same API as v4; the only
 * difference for /chat is that the title/subtitle now varies based on empty
 * vs active state, but that switch happens in ChatTopBar — this primitive
 * stays generic.
 */
export function TopBar({
  breadcrumb,
  accentDot,
  title,
  subtitle,
  actions,
}: TopBarProps) {
  return (
    <div className="h-[68px] flex-shrink-0 flex items-center gap-4 px-9 border-b border-border bg-background">
      <div className="min-w-0 flex-1">
        {breadcrumb && (
          <div className="text-[11px] text-foreground/40 uppercase tracking-[0.6px] font-medium mb-1">
            {breadcrumb}
          </div>
        )}
        <div className="flex items-center gap-2.5 min-w-0">
          {accentDot && <Dot color={accentDot} size={7} glow />}
          <h1
            className="font-geist text-[22px] font-semibold text-foreground truncate"
            style={{ letterSpacing: '-0.5px', lineHeight: 1.1 }}
          >
            {title}
          </h1>
        </div>
        {subtitle && (
          <div className="text-[12.5px] text-foreground/40 mt-0.5 truncate">
            {subtitle}
          </div>
        )}
      </div>
      {actions}
    </div>
  );
}
