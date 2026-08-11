import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import svelte from "eslint-plugin-svelte";
import ts from "typescript-eslint";
import svelteConfig from "./svelte.config.mjs";

export default defineConfig(
  {
    ignores: [
      ".vscode-test/**",
      ".validation/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "out/**",
      "playwright-report/**",
      "test-results/**",
      "tests/spike/dist/**",
    ],
  },
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: [
      "scripts/**/*.js",
      "tests/spike/**/*.{js,mjs}",
      "*.{js,mjs,mts,ts}",
    ],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["**/*.svelte.ts"],
    languageOptions: {
      parser: ts.parser,
      globals: globals.browser,
    },
  },
  {
    files: ["src/webview/**/*.{ts,svelte}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        extraFileExtensions: [".svelte"],
        parser: ts.parser,
        svelteConfig,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
      // Interactive selections synchronize a mutable local set from host snapshots.
      "svelte/prefer-writable-derived": "off",
      // svelte-check is the source of truth for compiler directives; ESLint cannot
      // determine whether a compiler diagnostic is intentionally suppressed.
      "svelte/no-unused-svelte-ignore": "off",
    },
  },
);
