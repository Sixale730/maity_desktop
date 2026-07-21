/**
 * ColorPicker Component
 * A simple color picker for avatar customization
 */

import { cn } from '@maity/shared';
import { Check } from 'lucide-react';

interface ColorPickerProps {
  label: string;
  colors: string[];
  value: string;
  onChange: (color: string) => void;
  className?: string;
}

export function ColorPicker({ label, colors, value, onChange, className }: ColorPickerProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div className="flex flex-wrap gap-2">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            className={cn(
              'w-8 h-8 rounded-lg border-2 transition-all duration-200',
              'hover:scale-110 hover:shadow-md',
              'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary',
              value === color
                ? 'border-primary ring-2 ring-primary ring-offset-1'
                : 'border-gray-200 dark:border-gray-700'
            )}
            style={{ backgroundColor: color }}
            title={color}
          >
            {value === color && (
              <Check
                className={cn(
                  'w-4 h-4 mx-auto',
                  isLightColor(color) ? 'text-gray-800' : 'text-white'
                )}
              />
            )}
          </button>
        ))}
      </div>
      {/* Custom color input */}
      <div className="flex items-center gap-2 mt-2">
        <input
          type="color"
          aria-label="Color personalizado"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border border-gray-200 dark:border-gray-700"
          title="Color personalizado"
        />
        <span className="text-xs text-muted-foreground">
          {value.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

/**
 * Determines if a color is light (for contrast)
 */
function isLightColor(hex: string): boolean {
  const color = hex.replace('#', '');
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128;
}
