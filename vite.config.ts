import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { sharePlugin } from './server/vitePlugin';

// GitHub Pages serves the app from /<repo>/, so the deploy build sets VITE_BASE.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), sharePlugin()],
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
