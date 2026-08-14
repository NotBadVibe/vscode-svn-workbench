import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ["browser"],
    alias: {
      vscode: fileURLToPath(
        new URL("./tests/mocks/vscode.ts", import.meta.url),
      ),
      "@protocol": fileURLToPath(new URL("./src/protocol", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts", "tests/components/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      include: [
        "src/protocol/**/*.ts",
        "src/scope/**/*.ts",
        "src/selection/**/*.ts",
        "src/security/**/*.ts",
        "src/ai/**/*.ts",
        "src/commit/**/*.ts",
        "src/conflict/**/*.ts",
        "src/changelist/**/*.ts",
        "src/history/**/*.ts",
        "src/properties/**/*.ts",
        "src/repository/**/*.ts",
        "src/svn/**/*.ts",
        "src/update/**/*.ts",
        "src/webview/app/**/*.ts",
      ],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
        "src/protocol/workbenchProtocol.ts": { branches: 90 },
        "src/ai/aiResultValidator.ts": { branches: 90 },
        "src/commit/commitFlow.ts": {
          statements: 100,
          branches: 95,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
