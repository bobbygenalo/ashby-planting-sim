import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { sharePlugin } from './server/vitePlugin';

export default defineConfig({
  plugins: [react(), sharePlugin()],
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
