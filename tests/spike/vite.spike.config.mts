import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

/*
 * Spike 专用构建：独立 root 与产物目录，不进入业务 webview 包。
 * SPIKE_FULL_LANGS=1 时关闭按需子集（全量语法，用于体积对照）。
 */
const subsetLangs = process.env.SPIKE_FULL_LANGS !== "1";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  resolve: {
    alias: [
      // 生产 CSP 垫片（v0.0.6）：edit spike 直接复用生产适配代码。
      {
        find: /^@prod\/csp-compat-observer$/,
        replacement: fileURLToPath(
          new URL(
            "../../src/webview/features/diff/cspCompatObserver.ts",
            import.meta.url,
          ),
        ),
      },
      ...(subsetLangs
        ? [
            // 精确匹配 "shiki" 根模块 → 语言子集 shim（见 shiki-subset-shim.ts）
            {
              find: /^shiki$/,
              replacement: fileURLToPath(
                new URL("./src/shiki-subset-shim.ts", import.meta.url),
              ),
            },
            // 裁剪 Oniguruma wasm（统一使用 JavaScript Regex 引擎）
            {
              find: /^shiki\/wasm$/,
              replacement: fileURLToPath(
                new URL("./src/shiki-wasm-stub.ts", import.meta.url),
              ),
            },
            // 精确匹配 "@pierre/theming/themes" → 主题子集 shim（仅 pierre-dark/light）
            {
              find: /^@pierre\/theming\/themes$/,
              replacement: fileURLToPath(
                new URL("./src/pierre-theming-subset-shim.ts", import.meta.url),
              ),
            },
          ]
        : []),
    ],
  },
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
