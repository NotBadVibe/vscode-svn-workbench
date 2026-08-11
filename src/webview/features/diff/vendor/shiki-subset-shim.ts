/*
 * Shiki 按需子集 shim（v0.0.4 阶段 1，移植自 tests/spike/src/shiki-subset-shim.ts）。
 *
 * @pierre/diffs 通过 `import { bundledLanguages } from "shiki"` 解析语言
 * （dist/highlighter/languages/resolveLanguage.js），shiki 根模块的
 * bundledLanguages 是全量注册表，Vite 会把全部 ~200 个语法打成 chunk
 * （按需加载但全部进产物）。本 shim 通过 src/webview/vite.config.mts 的
 * resolve.alias 精确替换 "shiki" 模块，只注册规划 §10 的语言子集
 * （清单见 ../diffLanguage.ts 的 DIFF_LANGUAGE_SUBSET，两者必须同步）；
 * 其余符号原样转发 shiki/core 与两个 engine 入口，行为不变。
 *
 * 注意：alias 为正则精确匹配 /^shiki$/，"shiki/core"、"shiki/engine/*"
 * 等子路径不受影响，仍指向真实模块。
 */
export * from "shiki/core";
export { createHighlighterCore as createHighlighter } from "shiki/core";
export { createJavaScriptRegexEngine } from "shiki/engine/javascript";
export { createOnigurumaEngine } from "shiki/engine/oniguruma";

/*
 * 与 v0.0.4 规划 §10 默认建议一致的语言子集：
 * ts/js、java、python、c/cpp、go、rust、xml、json、yaml、properties、shell、sql、diff。
 * 每个 loader 与原注册表同构：返回带 default 导出的 LanguageRegistration 模块；
 * 语言 chunk 保持懒加载，首屏只加载入口与当前文件语言。
 */
export const bundledLanguages = {
  typescript: () => import("@shikijs/langs/typescript"),
  javascript: () => import("@shikijs/langs/javascript"),
  java: () => import("@shikijs/langs/java"),
  python: () => import("@shikijs/langs/python"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  go: () => import("@shikijs/langs/go"),
  rust: () => import("@shikijs/langs/rust"),
  xml: () => import("@shikijs/langs/xml"),
  json: () => import("@shikijs/langs/json"),
  yaml: () => import("@shikijs/langs/yaml"),
  properties: () => import("@shikijs/langs/properties"),
  shell: () => import("@shikijs/langs/shell"),
  sql: () => import("@shikijs/langs/sql"),
  diff: () => import("@shikijs/langs/diff"),
};
