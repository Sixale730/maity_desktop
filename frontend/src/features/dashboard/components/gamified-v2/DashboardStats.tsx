'use client';
// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/DashboardStats.tsx
// Adaptaciones desktop: 'use client'.
// Progress Bar Component
export const ProgressBar = ({ value, max = 100, color = 'hsl(var(--maity-blue))', height = 'h-2', glow = false }: {
  value: number;
  max?: number;
  color?: string;
  height?: string;
  glow?: boolean;
}) => (
  <div className={`w-full bg-muted rounded-full overflow-hidden ${height}`}>
    <div
      className="h-full rounded-full transition-all duration-1000 ease-out"
      style={{
        width: `${(value / max) * 100}%`,
        backgroundColor: color,
        boxShadow: glow ? `0 0 10px ${color}60` : 'none'
      }}
    />
  </div>
);

/**
 * Pill stat shown in the in-page header — emoji icon + value + label.
 * Local to this dashboard; promote if another surface needs it.
 */
export function PillStat({
  icon,
  value,
  label,
  color,
}: {
  icon: string;
  value: number | string;
  label: string;
  color: string;
}) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-full"
      style={{
        padding: '7px 14px',
        background: `color-mix(in srgb, ${color} 6%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div>
        <div
          className="font-geist font-bold text-foreground"
          style={{ fontSize: 16, letterSpacing: '-0.3px', lineHeight: 1 }}
        >
          {value}
        </div>
        <div
          className="font-bold uppercase mt-0.5"
          style={{ fontSize: 9, color, letterSpacing: '0.6px' }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
