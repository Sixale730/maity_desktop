import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

interface ExpandableProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Expandable({ title, subtitle, badge, defaultOpen = false, children, className }: ExpandableProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={clsx('rounded-lg border border-surface-3 bg-surface-2/50 overflow-hidden transition-colors hover:border-surface-4', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-surface-2"
      >
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0"
        >
          <ChevronDown className="h-4 w-4 text-gray-500" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate">{title}</span>
            {badge}
          </div>
          {subtitle && <p className="mt-0.5 text-xs text-gray-600 truncate">{subtitle}</p>}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
          >
            <div className="border-t border-surface-3 p-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ExpandableSectionProps {
  label: string;
  value: string;
  mono?: boolean;
}

export function ExpandableDetail({ label, value, mono }: ExpandableSectionProps) {
  return (
    <div className="flex items-start justify-between gap-2 py-1">
      <span className="text-[10px] uppercase tracking-wider text-gray-600 shrink-0">{label}</span>
      <span className={clsx('text-xs text-gray-300 text-right', mono && 'font-mono')}>{value}</span>
    </div>
  );
}
