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
    alias: [
      { find: '@webview', replacement: fileURLToPath(new URL('.', import.meta.url)) },
      { find: '@protocol', replacement: fileURLToPath(new URL('../protocol', import.meta.url)) },
      // @pierre/diffs 按需子集（v0.0.4 §10）：精确替换 "shiki" 根模块为语言子集
      // shim（15 个语言 loader，chunk 懒加载）、"shiki/wasm" 裁 Oniguruma（统一
      // JavaScript Regex 引擎）、"@pierre/theming/themes" 只注册 pierre-dark/light。
      {
        find: /^shiki$/,
        replacement: fileURLToPath(new URL('./features/diff/vendor/shiki-subset-shim.ts', import.meta.url))
      },
      {
        find: /^shiki\/wasm$/,
        replacement: fileURLToPath(new URL('./features/diff/vendor/shiki-wasm-stub.ts', import.meta.url))
      },
      {
        find: /^@pierre\/theming\/themes$/,
        replacement: fileURLToPath(new URL('./features/diff/vendor/pierre-theming-subset-shim.ts', import.meta.url))
      }
    ]
  },
  server: {
    watch: {
      ignored: ['**/.validation/evidence/**', '**/docs/releases/v*/artifacts/**', '**/playwright-report/**', '**/test-results/**', '**/coverage/**']
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
