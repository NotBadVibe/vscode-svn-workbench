import { fileURLToPath, URL } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [
    tailwindcss(),
    svelte({
      configFile: fileURLToPath(new URL('../../svelte.config.mjs', import.meta.url))
    })
  ],
  resolve: {
    alias: {
      '@webview': fileURLToPath(new URL('.', import.meta.url)),
      '@protocol': fileURLToPath(new URL('../protocol', import.meta.url))
    }
  },
  server: {
    watch: {
      ignored: ['**/docs/releases/artifacts/**', '**/playwright-report/**', '**/test-results/**', '**/coverage/**']
    }
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist/webview', import.meta.url)),
    emptyOutDir: true,
    manifest: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
