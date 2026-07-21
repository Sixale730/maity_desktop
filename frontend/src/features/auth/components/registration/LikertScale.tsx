import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { cn, LikertValue, CompetencyColors, CompetencyArea } from '@maity/shared';

interface LikertScaleProps {
  value?: LikertValue | null;
  onChange: (value: LikertValue) => void;
  area: CompetencyArea;
  autoAdvance?: boolean;
  autoAdvanceDelay?: number; // milliseconds
}

const options: { value: LikertValue; label: string; shortLabel: string }[] = [
  { value: 1, label: 'Nada que ver conmigo 😢', shortLabel: 'Nunca' },
  { value: 2, label: 'A veces lo hago 😐', shortLabel: 'A veces' },
  { value: 3, label: 'Lo hago con normalidad 😊', shortLabel: 'Normal' },
  { value: 4, label: 'Casi siempre lo aplico bien 😄', shortLabel: 'Casi siempre' },
  { value: 5, label: 'Totalmente, así soy ✨', shortLabel: 'Siempre' },
];

export function LikertScale({
  value,
  onChange,
  area,
  autoAdvance = true,
  autoAdvanceDelay = 500,
}: LikertScaleProps) {
  const [selectedValue, setSelectedValue] = useState<LikertValue | null>(value || null);
  const color = CompetencyColors[area];

  useEffect(() => {
    if (value) {
      setSelectedValue(value);
    }
  }, [value]);

  const handleSelect = (val: LikertValue) => {
    setSelectedValue(val);
    onChange(val);
  };

  return (
    <div className="w-full space-y-6">
      {/* Helper Text */}
      <div className="space-y-2">
        <p className="text-sm text-center text-muted-foreground">
          Selecciona el número que describe mejor tu comportamiento ✨
        </p>
      </div>

      {/* Scale Buttons - Desktop: Horizontal, Mobile: Vertical */}
      <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-2">
        {options.map((option) => (
          <motion.button
            key={option.value}
            type="button"
            onClick={() => handleSelect(option.value)}
            className={cn(
              'flex sm:flex-col items-center gap-3 sm:gap-2 p-3 sm:p-4 rounded-xl border-2 transition-all duration-300',
              'hover:scale-[1.02] sm:hover:scale-105 active:scale-95',
              'focus:outline-none focus:ring-2 focus:ring-offset-2',
              'sm:flex-1', // Flex-1 only on desktop
              selectedValue === option.value
                ? 'border-current shadow-lg scale-[1.02] sm:scale-105'
                : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
            )}
            style={{
              color: selectedValue === option.value ? color : undefined,
              borderColor: selectedValue === option.value ? color : undefined,
              backgroundColor:
                selectedValue === option.value ? `${color}10` : undefined,
            }}
            whileTap={{ scale: 0.95 }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: option.value * 0.05 }}
          >
            {/* Number Circle */}
            <div
              className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center font-bold text-xl transition-all flex-shrink-0',
                selectedValue === option.value
                  ? 'text-white shadow-md'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
              )}
              style={{
                backgroundColor:
                  selectedValue === option.value ? color : undefined,
              }}
            >
              {option.value}
            </div>

            {/* Labels - Full text on desktop, short on mobile */}
            <div className="flex-1 sm:flex-none text-left sm:text-center">
              {/* Mobile: Full label */}
              <span
                className={cn(
                  'block sm:hidden text-base font-medium transition-colors',
                  selectedValue === option.value
                    ? 'font-semibold'
                    : 'text-gray-600 dark:text-gray-400'
                )}
                style={{
                  color: selectedValue === option.value ? color : undefined,
                }}
              >
                {option.label}
              </span>

              {/* Desktop: Short label */}
              <span
                className={cn(
                  'hidden sm:block text-xs font-medium text-center transition-colors',
                  selectedValue === option.value
                    ? 'font-semibold'
                    : 'text-gray-600 dark:text-gray-400'
                )}
                style={{
                  color: selectedValue === option.value ? color : undefined,
                }}
              >
                {option.shortLabel}
              </span>
            </div>
          </motion.button>
        ))}
      </div>

      {/* Legend for desktop short labels */}
      <div className="hidden sm:block text-xs text-center text-muted-foreground space-y-1">
        <p>1 = Nada que ver • 2 = A veces • 3 = Normal • 4 = Casi siempre • 5 = Totalmente</p>
      </div>
    </div>
  );
}
