import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3004' } },
  test: { include: ['server/**/*.test.ts', 'src/**/*.test.ts'] },
} as never);
