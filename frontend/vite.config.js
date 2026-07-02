import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@labflow-assets': fileURLToPath(new URL('../assets', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('monaco-editor') || id.includes('@monaco-editor') || id.includes('@coder')) {
              return 'vendor-monaco';
            }
            return 'vendor-core';
          }
          if (id.includes('/pages/workspace/admin/')) {
            return 'page-admin';
          }
          if (id.includes('/pages/workspace/student/')) {
            return 'page-student';
          }
          if (id.includes('/pages/workspace/reviewer/')) {
            return 'page-reviewer';
          }
        },
      },
    },
  },
});
