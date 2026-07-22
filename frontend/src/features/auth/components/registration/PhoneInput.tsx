import { useState, useEffect, useRef } from 'react';
import { Label } from '@/ui/components/ui/label';
import { Input } from '@/ui/components/ui/input';
import { cn } from '@maity/shared';
import { ChevronDown } from 'lucide-react';

const COUNTRIES = [
  { code: 'mx', dial: '52', name: 'México' },
  { code: 'us', dial: '1', name: 'Estados Unidos' },
  { code: 'co', dial: '57', name: 'Colombia' },
  { code: 'ar', dial: '54', name: 'Argentina' },
  { code: 'cl', dial: '56', name: 'Chile' },
  { code: 'pe', dial: '51', name: 'Perú' },
  { code: 'es', dial: '34', name: 'España' },
  { code: 'br', dial: '55', name: 'Brasil' },
] as const;

function FlagImg({ code, size = 20 }: { code: string; size?: number }) {
  const [failed, setFailed] = useState(false);

  // Fallback: si la bandera no carga (CSP, offline o firewall), mostrar el código del país
  // en vez del icono de imagen rota.
  if (failed) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-sm bg-muted text-[10px] font-semibold uppercase text-muted-foreground"
        style={{ width: size, height: Math.round(size * 0.75) }}
      >
        {code}
      </span>
    );
  }

  return (
    <img
      src={`https://flagcdn.com/w${size}/${code}.png`}
      alt={code.toUpperCase()}
      width={size}
      height={Math.round(size * 0.75)}
      className="inline-block rounded-sm object-cover"
      loading="eager"
      onError={() => setFailed(true)}
    />
  );
}

type Country = (typeof COUNTRIES)[number];

interface PhoneInputProps {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  className?: string;
}

function parsePhoneValue(value: string): { country: Country; localNumber: string } {
  if (!value || !value.startsWith('+')) {
    return { country: COUNTRIES[0], localNumber: '' };
  }

  // Try to match a country dial code (longest match first)
  const sorted = COUNTRIES.toSorted((a, b) => b.dial.length - a.dial.length);
  for (const c of sorted) {
    if (value.startsWith(`+${c.dial}`)) {
      return { country: c, localNumber: value.slice(1 + c.dial.length) };
    }
  }

  return { country: COUNTRIES[0], localNumber: value.replace(/^\+\d*/, '') };
}

export function PhoneInput({
  id,
  label,
  placeholder,
  value,
  onChange,
  error,
  className,
}: PhoneInputProps) {
  const { country: initialCountry, localNumber: initialLocal } = parsePhoneValue(value);
  const [selectedCountry, setSelectedCountry] = useState<Country>(initialCountry);
  const [localNumber, setLocalNumber] = useState(initialLocal);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync internal state when value prop changes externally
  useEffect(() => {
    const { country, localNumber: parsed } = parsePhoneValue(value);
    setSelectedCountry(country);
    setLocalNumber(parsed);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const emitValue = (country: Country, local: string) => {
    onChange(`+${country.dial}${local}`);
  };

  const handleLocalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
    setLocalNumber(digits);
    emitValue(selectedCountry, digits);
  };

  const handleCountrySelect = (country: Country) => {
    setSelectedCountry(country);
    setIsOpen(false);
    emitValue(country, localNumber);
  };

  return (
    <div className={cn('space-y-3', className)}>
      <Label htmlFor={id} className="text-lg font-medium">
        {label}
      </Label>

      <div className="flex gap-2">
        {/* Country selector + dial code */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1 h-12 px-3 rounded-md border border-input bg-background text-sm hover:bg-accent transition-colors min-w-[100px]"
          >
            <FlagImg code={selectedCountry.code} />
            <span className="text-muted-foreground font-medium">+{selectedCountry.dial}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
          </button>

          {isOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-popover border border-border rounded-md shadow-lg z-50 py-1 max-h-60 overflow-y-auto">
              {COUNTRIES.map((country) => (
                <button
                  key={country.code}
                  type="button"
                  onClick={() => handleCountrySelect(country)}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent transition-colors',
                    selectedCountry.code === country.code && 'bg-accent'
                  )}
                >
                  <FlagImg code={country.code} />
                  <span className="flex-1 text-left">{country.name}</span>
                  <span className="text-muted-foreground">+{country.dial}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Local number input */}
        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          placeholder={placeholder || '10 dígitos'}
          value={localNumber}
          onChange={handleLocalChange}
          className="text-base h-12 flex-1"
          maxLength={10}
          autoFocus
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
