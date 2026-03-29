import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.tsx'],
    globals: true,
    css: false,
  },
  define: {
    'process.env.config': '{}',
    'process.env.NEXT_RUNTIME': '"nodejs"',
  },


  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src').replace(/\\/g, '/'),
    },

  },
});
