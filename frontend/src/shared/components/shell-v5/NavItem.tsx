import { LucideIcon } from 'lucide-react';

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  badge?: string;
  active?: boolean;
  disabled?: boolean;
  disabledTooltip?: string;
  onClick?: () => void;
}

/**
 * Sidebar nav row. v5 spec: padding 7px 10px (tighter than v4's 8px), fontSize
 * 12.5, active state uses the Productividad-blue tint regardless of zone (the
 * blue is the "selected" signal across the sidebar).
 */
export function NavItem({
  icon: Icon,
  label,
  badge,
  active,
  disabled,
  disabledTooltip,
  onClick,
}: NavItemProps) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? disabledTooltip : undefined}
      className={[
        'w-full flex items-center gap-2.5 px-2.5 my-px rounded-lg text-left transition-colors',
        active
          ? 'bg-[rgba(72,93,244,0.12)] border border-[rgba(72,93,244,0.25)] text-foreground font-semibold'
          : 'border border-transparent text-foreground/60 font-medium hover:bg-card/50',
        disabled ? 'cursor-not-allowed opacity-60 hover:bg-transparent' : 'cursor-pointer',
      ].join(' ')}
      style={{ paddingTop: 7, paddingBottom: 7, fontSize: 12.5 }}
    >
      <Icon
        size={13}
        className={active ? 'text-maity-blue' : 'text-current'}
        strokeWidth={1.8}
      />
      <span className="flex-1 truncate">{label}</span>
      {badge && (
        <span
          className="text-[9.5px] px-1.5 py-px rounded-full bg-card-hi text-foreground/60 font-semibold tracking-[0.3px]"
        >
          {badge}
        </span>
      )}
    </button>
  );
}
