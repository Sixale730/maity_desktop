import type { Config } from "tailwindcss";

export default {
  darkMode: 'class',
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/shared/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Base — usan CSS vars de globals.css con hsl() wrapper
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        // Brand colors — objetos con DEFAULT + foreground (patrón shadcn)
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        // Chart colors (Recharts)
        chart: {
          '1': "hsl(var(--chart-1) / <alpha-value>)",
          '2': "hsl(var(--chart-2) / <alpha-value>)",
          '3': "hsl(var(--chart-3) / <alpha-value>)",
          '4': "hsl(var(--chart-4) / <alpha-value>)",
          '5': "hsl(var(--chart-5) / <alpha-value>)",
        },
        // Sidebar (global del desktop). Con <alpha-value>: las vars son H S L sin alpha
        // (globals.css; la web usa white/10 en --sidebar-border oscuro, aquí es opaco).
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          primary: "hsl(var(--sidebar-primary) / <alpha-value>)",
          'primary-foreground': "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          accent: "hsl(var(--sidebar-accent) / <alpha-value>)",
          'accent-foreground': "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
        },
        // Surface elevated
        "surface-elevated": {
          DEFAULT: "hsl(var(--surface-elevated) / <alpha-value>)",
          foreground: "hsl(var(--surface-elevated-foreground) / <alpha-value>)",
        },
        // v5 chat zone tokens (vienen de globals.css)
        "card-hi": "hsl(var(--card-hi) / <alpha-value>)",
        "rail-bg": "hsl(var(--rail-bg) / <alpha-value>)",
        "border-strong": "hsl(var(--border-strong) / <alpha-value>)",
        // Colores de marca (paridad con la web sep-2026: cada uno con su var propia)
        "maity-pink": "hsl(var(--maity-pink) / <alpha-value>)",
        "maity-blue": "hsl(var(--maity-blue) / <alpha-value>)",
        "maity-green": "hsl(var(--maity-green) / <alpha-value>)",
        "maity-amber": "hsl(var(--maity-amber) / <alpha-value>)",
        "maity-warning": "hsl(var(--maity-warning) / <alpha-value>)",
        "dashboard-gold": "hsl(var(--dashboard-gold) / <alpha-value>)",
      },
      fontFamily: {
        geist: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        inter: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Web (sep-2026): etiquetas mini del dashboard/sidebar
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
        'display': ['32px', { lineHeight: '1.2', fontWeight: '700' }],
        'h1': ['24px', { lineHeight: '1.3', fontWeight: '600' }],
        'h2': ['18px', { lineHeight: '1.4', fontWeight: '500' }],
        'body': ['16px', { lineHeight: '1.6', fontWeight: '400' }],
        'small': ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        'caption': ['12px', { lineHeight: '1.4', fontWeight: '400' }],
      },
      // Web (sep-2026): giro con pausa del Spinner (components/ui/spinner.tsx)
      keyframes: {
        'spin-pause': {
          '0%': { transform: 'rotate(0deg)' },
          '75%': { transform: 'rotate(360deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'spin-pause': 'spin-pause 2s ease-in-out infinite',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
} satisfies Config;
