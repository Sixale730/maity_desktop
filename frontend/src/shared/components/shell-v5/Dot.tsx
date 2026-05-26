interface DotProps {
  color: string;
  size?: number;
  glow?: boolean;
  className?: string;
}

/**
 * Solid color dot used across the shell (zone switcher, urgency markers,
 * lens picker, calendar cells). Hex colors only — these are not tied to
 * design tokens because the dot reflects a specific data signal.
 */
export function Dot({ color, size = 6, glow = false, className = '' }: DotProps) {
  return (
    <span
      className={`inline-block rounded-full shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background: color,
        boxShadow: glow ? `0 0 8px ${color}` : undefined,
      }}
    />
  );
}
