import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    css: true,
    environment: 'jsdom',
    setupFiles: ['./src/testing/setup-tests.ts'],
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
