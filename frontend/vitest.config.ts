import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Array (no objeto): la primera coincidencia gana, así que los alias
    // específicos (espejo de `paths` en tsconfig.json) van ANTES que `@`.
    // Los `@/features/omi/*` los usan los archivos copiados tal cual de la web
    // (dashboard de expedición) y resuelven a adapters del desktop.
    alias: [
      { find: /^@\/features\/omi\/services\/omi\.service$/, replacement: path.resolve(__dirname, './src/features/dashboard/adapters/omi.service.ts') },
      { find: /^@\/features\/omi\/utils\/feedback-scores$/, replacement: path.resolve(__dirname, './src/features/dashboard/adapters/feedback-scores.ts') },
      { find: /^@\/features\/omi\/components\/analysis\/dashboard-v1\/adapter$/, replacement: path.resolve(__dirname, './src/features/conversations/components/analysis/dashboard-v1/adapter.ts') },
      { find: /^@\/ui\/components\/ui\/(.*)$/, replacement: path.resolve(__dirname, './src/components/ui') + '/$1' },
      { find: /^@maity\/shared$/, replacement: path.resolve(__dirname, './src/shared/maity-shared.ts') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'src-tauri', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'src/lib/**/*.ts',
        'src/hooks/**/*.ts',
        'src/services/**/*.ts',
        'src/features/**/utils/**/*.ts',
        'src/features/**/services/**/*.ts',
      ],
      exclude: [
        'src/test/**',
        'src/**/*.d.ts',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
      ],
    },
  },
});
