/**
 * OutfitSelector Component
 * Grid selector for choosing between preset outfits (casual, business, worker, etc.)
 */

import { cn, OUTFIT_PRESETS } from '@maity/shared';
import { Check } from 'lucide-react';
import type { OutfitPreset } from '@maity/shared';

interface OutfitSelectorProps {
  selected: OutfitPreset;
  onChange: (preset: OutfitPreset) => void;
  className?: string;
}

export function OutfitSelector({ selected, onChange, className }: OutfitSelectorProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <span className="text-sm font-medium text-foreground">
        Elige tu Vestimenta
      </span>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {OUTFIT_PRESETS.map((outfit) => {
          const isSelected = selected === outfit.id;
          return (
            <button
              key={outfit.id}
              type="button"
              onClick={() => onChange(outfit.id)}
              className={cn(
                'relative flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all duration-200',
                'hover:scale-105 hover:shadow-lg',
                'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary',
                isSelected
                  ? 'border-primary bg-primary/10 shadow-md'
                  : 'border-gray-200 dark:border-gray-700 bg-background hover:border-primary/50'
              )}
            >
              {/* Selection indicator */}
              {isSelected && (
                <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-white" />
                </div>
              )}

              {/* Outfit emoji */}
              <span className="text-2xl mb-1">{outfit.emoji}</span>

              {/* Outfit name */}
              <span
                className={cn(
                  'text-xs font-medium text-center',
                  isSelected ? 'text-primary' : 'text-foreground'
                )}
              >
                {outfit.name}
              </span>

              {/* Color preview */}
              <div className="flex gap-1 mt-1">
                <div
                  className="w-3 h-3 rounded-sm border border-gray-300"
                  style={{ backgroundColor: outfit.shirtColor }}
                  title="Camisa"
                />
                <div
                  className="w-3 h-3 rounded-sm border border-gray-300"
                  style={{ backgroundColor: outfit.pantsColor }}
                  title="Pantalon"
                />
                {outfit.hasTie && outfit.tieColor && (
                  <div
                    className="w-3 h-3 rounded-sm border border-gray-300"
                    style={{ backgroundColor: outfit.tieColor }}
                    title="Corbata"
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default OutfitSelector;
