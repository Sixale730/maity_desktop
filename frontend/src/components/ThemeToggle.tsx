'use client';
import { useTheme } from '@/contexts/ThemeContext';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={toggleTheme}
          className="relative inline-flex items-center justify-center w-10 h-10 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-950 focus:ring-blue-500"
          aria-label="Cambiar tema"
        >
          {theme === 'dark' ? (
            // Moon icon (for light mode)
            <svg
              className="w-5 h-5 text-yellow-400 transition-transform duration-300"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          ) : (
            // Sun icon (for dark mode)
            <svg
              className="w-5 h-5 text-amber-500 transition-transform duration-300"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 2a1 1 0 011 1v2a1 1 0 11-2 0V3a1 1 0 011-1zm4.293 1.293a1 1 0 011.414 0l1.414 1.414a1 1 0 11-1.414 1.414L14.293 3.707a1 1 0 010-1.414zm2.414 4.414a1 1 0 111.414-1.414l1.414 1.414a1 1 0 11-1.414 1.414l-1.414-1.414zM10 18a1 1 0 011 1v2a1 1 0 11-2 0v-2a1 1 0 011-1zm-4.293-1.293a1 1 0 011.414 0l1.414 1.414a1 1 0 11-1.414 1.414l-1.414-1.414a1 1 0 010-1.414zM2.707 5.707a1 1 0 011.414 0L5.535 7.535a1 1 0 11-1.414 1.414L2.707 7.121a1 1 0 010-1.414zm10.586 10.586a1 1 0 011.414 0l1.414 1.414a1 1 0 11-1.414 1.414l-1.414-1.414a1 1 0 010-1.414zM2 10a1 1 0 011 1v2a1 1 0 11-2 0v-2a1 1 0 011-1zm10-8a1 1 0 011 1v2a1 1 0 11-2 0V3a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        Cambiar tema
      </TooltipContent>
    </Tooltip>
  );
}
