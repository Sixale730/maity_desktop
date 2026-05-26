import { ReactNode } from 'react';

/**
 * Inline highlight emitted by Maity with `==text==` markdown. Rendered as a
 * two-stop gradient so the amber color only covers the bottom 45% of the line
 * height — looks like a highlighter pen swipe rather than a solid bg.
 */
export function ChatMark({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        background:
          'linear-gradient(180deg, transparent 55%, rgba(246,179,82,0.32) 55%)',
        padding: '0 2px',
      }}
    >
      {children}
    </span>
  );
}
