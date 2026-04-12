import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@echidna-claw/config/browser': fileURLToPath(
        new URL('../../packages/config/src/browser.ts', import.meta.url),
      ),
    },
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
