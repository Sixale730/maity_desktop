import { KeyboardEvent } from 'react';

interface EntryStarterCardProps {
  /** Card title (e.g. "Algo que estoy pensando"). */
  kind: string;
  /** One-line hint shown under the title. */
  hint: string;
  /** Single-character display glyph (·, ◇, ↑, ↻). Renders large in Geist. */
  glyph: string;
  /** Hex accent color (matches the entry_type). */
  color: string;
  /** Up to 3 example phrases shown as chips below the hint. */
  examples: string[];
  /** Called when the user clicks the card (no chip) or a chip inside it.
   *  Empty `chip` means the card body was clicked; a string means that
   *  specific chip was clicked. Stops propagation on chip clicks so the
   *  outer card click doesn't fire too. */
  onSelect: (chip?: string) => void;
}

/**
 * One of the four "punto de partida" cards on the empty state.
 *
 * Clicking the card body sends a message-open prompt for the entry_type;
 * clicking a chip sends a message anchored to that chip's topic. Both
 * trigger thread creation in the parent and Maity replies on the assistant
 * turn.
 *
 * Note: the outer container is a `<div role="button">` instead of a real
 * `<button>` because HTML doesn't allow nested buttons (the parser des-
 * anida them and Vite warns at build). Chips are real `<button>` elements
 * inside; the div handles Enter/Space for keyboard accessibility.
 */
export function EntryStarterCard({
  kind,
  hint,
  glyph,
  color,
  examples,
  onSelect,
}: EntryStarterCardProps) {
  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect()}
      onKeyDown={handleKey}
      className="text-left rounded-[14px] bg-card border border-border text-foreground flex flex-col gap-2 hover:bg-card-hi/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-colors cursor-pointer"
      style={{ padding: '18px 18px 14px' }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="grid place-items-center font-geist font-semibold"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: `${color}1c`,
            color,
            fontSize: 18,
          }}
        >
          {glyph}
        </span>
        <div
          className="font-geist font-semibold text-foreground"
          style={{ fontSize: 15.5, letterSpacing: '-0.3px' }}
        >
          {kind}
        </div>
      </div>
      <div className="text-foreground/60" style={{ fontSize: 13, lineHeight: 1.45 }}>
        {hint}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {examples.map((e) => (
          <button
            type="button"
            key={e}
            onClick={(ev) => {
              ev.stopPropagation();
              onSelect(e);
            }}
            className="text-foreground/60 border border-border hover:bg-card-hi/60 hover:text-foreground transition-colors cursor-pointer"
            style={{
              fontSize: 10.5,
              padding: '3px 8px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.04)',
            }}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
